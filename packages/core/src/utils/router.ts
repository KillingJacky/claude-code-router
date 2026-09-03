import { get_encoding } from "tiktoken";
import { readFile, appendFile } from "fs/promises";
import { opendir, stat } from "fs/promises";
import { join } from "path";
import { CLAUDE_PROJECTS_DIR, HOME_DIR } from "@CCR/shared";
import { LRUCache } from "lru-cache";
import { ConfigService } from "../services/config";
import { TokenizerService } from "../services/tokenizer";

// Types from @anthropic-ai/sdk
interface Tool {
  name: string;
  description?: string;
  input_schema: object;
}

interface ContentBlockParam {
  type: string;
  [key: string]: any;
}

interface MessageParam {
  role: string;
  content: string | ContentBlockParam[];
}

interface MessageCreateParamsBase {
  messages?: MessageParam[];
  system?: string | any[];
  tools?: Tool[];
  [key: string]: any;
}

const enc = get_encoding("cl100k_base");

export const calculateTokenCount = (
  messages: MessageParam[],
  system: any,
  tools: Tool[]
) => {
  let tokenCount = 0;
  if (Array.isArray(messages)) {
    messages.forEach((message) => {
      if (typeof message.content === "string") {
        tokenCount += enc.encode(message.content).length;
      } else if (Array.isArray(message.content)) {
        message.content.forEach((contentPart: any) => {
          if (contentPart.type === "text") {
            tokenCount += enc.encode(contentPart.text).length;
          } else if (contentPart.type === "tool_use") {
            tokenCount += enc.encode(JSON.stringify(contentPart.input)).length;
          } else if (contentPart.type === "tool_result") {
            tokenCount += enc.encode(
              typeof contentPart.content === "string"
                ? contentPart.content
                : JSON.stringify(contentPart.content)
            ).length;
          }
        });
      }
    });
  }
  if (typeof system === "string") {
    tokenCount += enc.encode(system).length;
  } else if (Array.isArray(system)) {
    system.forEach((item: any) => {
      if (item.type !== "text") return;
      if (typeof item.text === "string") {
        tokenCount += enc.encode(item.text).length;
      } else if (Array.isArray(item.text)) {
        item.text.forEach((textPart: any) => {
          tokenCount += enc.encode(textPart || "").length;
        });
      }
    });
  }
  if (tools) {
    tools.forEach((tool: Tool) => {
      if (tool.description) {
        tokenCount += enc.encode(tool.name + tool.description).length;
      }
      if (tool.input_schema) {
        tokenCount += enc.encode(JSON.stringify(tool.input_schema)).length;
      }
    });
  }
  return tokenCount;
};

const getProjectSpecificRouter = async (
  req: any,
  configService: ConfigService
) => {
  // Check if there is project-specific configuration
  if (req.sessionId) {
    const project = await searchProjectBySession(req.sessionId);
    if (project) {
      const projectConfigPath = join(HOME_DIR, project, "config.json");
      const sessionConfigPath = join(
        HOME_DIR,
        project,
        `${req.sessionId}.json`
      );

      // First try to read sessionConfig file
      try {
        const sessionConfig = JSON.parse(await readFile(sessionConfigPath, "utf8"));
        if (sessionConfig && sessionConfig.Router) {
          return { router: sessionConfig.Router, source: "session" as const };
        }
      } catch {}
      try {
        const projectConfig = JSON.parse(await readFile(projectConfigPath, "utf8"));
        if (projectConfig && projectConfig.Router) {
          return { router: projectConfig.Router, source: "project" as const };
        }
      } catch {}
    }
  }
  return undefined; // Return undefined to use original configuration
};

const getVisionModel = (router: any): string | undefined =>
  router?.capabilities?.vision || router?.image;

const getWebSearchModel = (router: any): string | undefined =>
  router?.capabilities?.webSearch || router?.webSearch;

const getPrimaryModel = (router: any): string | undefined =>
  router?.primary || router?.default;

export type RouterModelAlias =
  | "haiku"
  | "sonnet"
  | "opus";

export interface RouterRouteDecision {
  model: string | undefined;
  scenarioType: RouterScenarioType;
  fallbackKey: string;
}

type RouterSource = "explicit" | "global" | "project" | "session";
type RouterRouteDecisionWithSource = RouterRouteDecision & {
  routerSource: RouterSource;
};

const getModelAlias = (model: unknown): RouterModelAlias | undefined => {
  if (typeof model !== "string") return undefined;
  const normalized = model.toLowerCase();

  if (normalized.includes("haiku")) return "haiku";
  if (normalized.includes("sonnet")) return "sonnet";
  if (normalized.includes("opus")) return "opus";
  return undefined;
};

const getAliasModel = (router: any, alias: RouterModelAlias): string | undefined => {
  if (router?.aliases?.[alias]) return router.aliases[alias];
  return alias === "haiku" ? router?.background : undefined;
};

const extractRouteTag = (req: any, tagName: string): string | undefined => {
  const contentPattern = tagName === "CCR-SUBAGENT-MODEL" ? "([^<]+)" : "([\\w.-]+)";
  const tag = new RegExp(`<${tagName}>${contentPattern}<\\/${tagName}>`);
  const system = req.body?.system;
  if (!Array.isArray(system)) return undefined;

  for (const block of system) {
    if (typeof block?.text !== "string") continue;
    const match = block.text.match(tag);
    if (!match) continue;
    block.text = block.text.replace(tag, "");
    return match[1].trim();
  }
  return undefined;
};

const hasCurrentUserImage = (messages: any): boolean => {
  if (!Array.isArray(messages)) return false;
  const lastUserMessage = [...messages]
    .reverse()
    .find((message: any) => message.role === "user");
  return Array.isArray(lastUserMessage?.content) && lastUserMessage.content.some(
    (item: any) =>
      item.type === "image" ||
      (Array.isArray(item?.content) &&
        item.content.some((part: any) => part.type === "image"))
  );
};

export const resolveRouterRoute = (
  req: any,
  router: any,
  forceUseImageAgent = false
): RouterRouteDecision => {
  const explicitModel = extractRouteTag(req, "CCR-SUBAGENT-MODEL");
  if (explicitModel) {
    return {
      model: explicitModel,
      scenarioType: "subagent",
      fallbackKey: "subagent",
    };
  }

  const profile = extractRouteTag(req, "CCR-ROUTE");
  if (profile && router?.subagents?.[profile]) {
    return {
      model: router.subagents[profile],
      scenarioType: "subagent",
      fallbackKey: `subagents.${profile}`,
    };
  }

  const visionModel = getVisionModel(router);
  if (!forceUseImageAgent && visionModel && hasCurrentUserImage(req.body?.messages)) {
    return {
      model: visionModel,
      scenarioType: "image",
      fallbackKey: "capabilities.vision",
    };
  }

  const webSearchModel = getWebSearchModel(router);
  if (
    webSearchModel &&
    Array.isArray(req.body?.tools) &&
    req.body.tools.some((tool: any) => tool.type?.startsWith("web_search"))
  ) {
    return {
      model: webSearchModel,
      scenarioType: "webSearch",
      fallbackKey: "capabilities.webSearch",
    };
  }

  const alias = getModelAlias(req.body?.model);
  const aliasModel = alias && getAliasModel(router, alias);
  if (aliasModel) {
    return {
      model: aliasModel,
      scenarioType: "alias",
      fallbackKey: `aliases.${alias}`,
    };
  }

  return {
    model: getPrimaryModel(router),
    scenarioType: "default",
    fallbackKey: "default",
  };
};

export const getUseModel = async (
  req: any,
  configService: ConfigService
): Promise<RouterRouteDecisionWithSource> => {
  const projectSpecificRouter = await getProjectSpecificRouter(req, configService);
  const providers = configService.get<any[]>("providers") || [];
  const Router = projectSpecificRouter?.router || configService.get("Router");
  const routerSource = projectSpecificRouter?.source || "global";

  if (req.body.model.includes(",")) {
    const [provider, model] = req.body.model.split(",");
    const finalProvider = providers.find(
      (p: any) => p.name.toLowerCase() === provider
    );
    const finalModel = finalProvider?.models?.find(
      (m: any) => m.toLowerCase() === model
    );
    if (finalProvider && finalModel) {
      return {
        model: `${finalProvider.name},${finalModel}`,
        scenarioType: 'default',
        fallbackKey: 'default',
        routerSource: 'explicit',
      };
    }
    return {
      model: req.body.model,
      scenarioType: 'default',
      fallbackKey: 'default',
      routerSource: 'explicit',
    };
  }

  return {
    ...resolveRouterRoute(req, Router, configService.get("forceUseImageAgent")),
    routerSource,
  };
};

function getLastUserMessageText(messages: MessageParam[]): string {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        return msg.content;
      } else if (Array.isArray(msg.content)) {
        return msg.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text || '')
          .join('');
      }
    }
  }
  return '';
}

function getTransformerNames(model: string, configService: ConfigService): string[] {
  if (!model || !model.includes(',')) return [];
  const commaIndex = model.indexOf(',');
  const providerName = model.slice(0, commaIndex);
  const modelName = model.slice(commaIndex + 1);
  const providers = configService.get<any[]>('providers') || [];
  const provider = providers.find((p: any) => p.name?.toLowerCase() === providerName.toLowerCase());
  if (!provider) return [];

  const names: string[] = [];
  const extractName = (t: any) => {
    if (typeof t === 'string') return t;
    if (Array.isArray(t) && typeof t[0] === 'string') return t[0];
    return null;
  };

  if (Array.isArray(provider.transformer?.use)) {
    for (const t of provider.transformer.use) {
      const name = extractName(t);
      if (name) names.push(name);
    }
  }
  if (Array.isArray(provider.transformer?.[modelName]?.use)) {
    for (const t of provider.transformer[modelName].use) {
      const name = extractName(t);
      if (name) names.push(name);
    }
  }
  return names;
}

const MAX_ROUTE_LOG_MESSAGE_LENGTH = 1000;

interface RouteLogDetails {
  event?: "route_selected" | "route_error" | "fallback_attempt" | "fallback_succeeded" | "fallback_failed";
  fallbackIndex?: number;
  fallbackTotal?: number;
  errorCode?: string;
  statusCode?: number;
}

export async function writeRouteLog(
  req: any,
  model: string | undefined,
  configService: ConfigService,
  details: RouteLogDetails = {}
): Promise<void> {
  try {
    const msg = getLastUserMessageText(req.body?.messages || []);
    const entry = {
      time: new Date().toISOString(),
      event: details.event || "route_selected",
      reqId: req.id,
      msg: Array.from(msg).slice(-MAX_ROUTE_LOG_MESSAGE_LENGTH).join(""),
      requestedModel: req.requestedModel,
      tokenCount: req.tokenCount,
      route: req.scenarioType || 'default',
      routeFallbackKey: req.routeFallbackKey,
      routerSource: req.routerSource,
      model,
      selectedModel: req.routedModel,
      fallbackIndex: details.fallbackIndex,
      fallbackTotal: details.fallbackTotal,
      errorCode: details.errorCode,
      statusCode: details.statusCode,
      transformers: getTransformerNames(model || "", configService),
    };
    await appendFile(join(HOME_DIR, 'route.log'), JSON.stringify(entry) + '\n');
  } catch {
    // Do not let logging errors affect the main request
  }
}

export interface RouterContext {
  configService: ConfigService;
  tokenizerService?: TokenizerService;
  event?: any;
}

export type RouterScenarioType = 'default' | 'alias' | 'subagent' | 'image' | 'webSearch';

export interface RouterFallbackConfig {
  primary?: string[];
  default?: string[];
  alias?: string[];
  subagent?: string[];
  image?: string[];
  webSearch?: string[];
  aliases?: Partial<Record<RouterModelAlias, string[]>>;
  capabilities?: {
    webSearch?: string[];
    vision?: string[];
  };
  subagents?: Record<string, string[]>;
  background?: string[];
  think?: string[];
  longContext?: string[];
}

export const extractSessionId = (req: any): string | undefined => {
  const sessionHeader = req.headers?.["x-claude-code-session-id"];
  const headerValue = Array.isArray(sessionHeader)
    ? sessionHeader[0]
    : sessionHeader;
  if (typeof headerValue === "string" && headerValue) {
    return headerValue;
  }

  const userId = req.body?.metadata?.user_id;
  if (typeof userId !== "string" || !userId) {
    return undefined;
  }

  try {
    const metadata = JSON.parse(userId);
    if (typeof metadata.session_id === "string" && metadata.session_id) {
      return metadata.session_id;
    }
  } catch {}

  const parts = userId.split("_session_");
  return parts.length > 1 ? parts[1] : undefined;
};

export const router = async (req: any, _res: any, context: RouterContext) => {
  const { configService, event } = context;
  const sessionId = extractSessionId(req);
  if (sessionId) {
    req.sessionId = sessionId;
  }
  const { messages, system = [], tools }: MessageCreateParamsBase = req.body;
  req.requestedModel = req.body?.model;
  const rewritePrompt = configService.get("REWRITE_SYSTEM_PROMPT");
  if (
    rewritePrompt &&
    system.length > 1 &&
    system[1]?.text?.includes("<env>")
  ) {
    const prompt = await readFile(rewritePrompt, "utf-8");
    system[1].text = `${prompt}<env>${system[1].text.split("<env>").pop()}`;
  }

  try {
    // Try to get tokenizer config for the current model
    const [providerName, modelName] = req.body.model.split(",");
    const tokenizerConfig = context.tokenizerService?.getTokenizerConfigForModel(
      providerName,
      modelName
    );

    // Use TokenizerService if available, otherwise fall back to legacy method
    let tokenCount: number;

    if (context.tokenizerService) {
      const result = await context.tokenizerService.countTokens(
        {
          messages: messages as MessageParam[],
          system,
          tools: tools as Tool[],
        },
        tokenizerConfig
      );
      tokenCount = result.tokenCount;
    } else {
      // Legacy fallback
      tokenCount = calculateTokenCount(
        messages as MessageParam[],
        system,
        tools as Tool[]
      );
    }
    req.tokenCount = tokenCount;

    let model;
    const customRouterPath = configService.get("CUSTOM_ROUTER_PATH");
    if (customRouterPath) {
      try {
        const customRouter = require(customRouterPath);
        model = await customRouter(req, configService.getAll(), {
          event,
        });
      } catch (e: any) {
        req.log.error(`failed to load custom router: ${e.message}`);
      }
    }
    if (!model) {
      const result = await getUseModel(req, configService);
      model = result.model;
      req.scenarioType = result.scenarioType;
      req.routeFallbackKey = result.fallbackKey;
      req.routerSource = result.routerSource;
    } else {
      // Custom router doesn't provide scenario type, default to 'default'
      req.scenarioType = 'default';
      req.routeFallbackKey = 'default';
      req.routerSource = 'custom';
    }
    req.body.model = model;
    req.routedModel = model;
    await writeRouteLog(req, model, configService);
  } catch (error: any) {
    req.log.error(`Error in router middleware: ${error.message}`);
    const Router = configService.get("Router");
    req.body.model = getPrimaryModel(Router);
    req.scenarioType = 'default';
    req.routeFallbackKey = 'default';
    req.routerSource = 'error_fallback';
    req.routedModel = req.body.model;
    await writeRouteLog(req, req.body.model, configService, {
      event: 'route_error',
      errorCode: error.code,
      statusCode: error.statusCode,
    });
  }
  return;
};

// Memory cache for sessionId to project name mapping
// null value indicates previously searched but not found
// Uses LRU cache with max 1000 entries
const sessionProjectCache = new LRUCache<string, string>({
  max: 1000,
});

export const searchProjectBySession = async (
  sessionId: string
): Promise<string | null> => {
  // Check cache first
  if (sessionProjectCache.has(sessionId)) {
    const result = sessionProjectCache.get(sessionId);
    if (!result || result === '') {
      return null;
    }
    return result;
  }

  try {
    const dir = await opendir(CLAUDE_PROJECTS_DIR);
    const folderNames: string[] = [];

    // Collect all folder names
    for await (const dirent of dir) {
      if (dirent.isDirectory()) {
        folderNames.push(dirent.name);
      }
    }

    // Concurrently check each project folder for sessionId.jsonl file
    const checkPromises = folderNames.map(async (folderName) => {
      const sessionFilePath = join(
        CLAUDE_PROJECTS_DIR,
        folderName,
        `${sessionId}.jsonl`
      );
      try {
        const fileStat = await stat(sessionFilePath);
        return fileStat.isFile() ? folderName : null;
      } catch {
        // File does not exist, continue checking next
        return null;
      }
    });

    const results = await Promise.all(checkPromises);

    // Return the first existing project directory name
    for (const result of results) {
      if (result) {
        // Cache the found result
        sessionProjectCache.set(sessionId, result);
        return result;
      }
    }

    // Cache not found result (null value means previously searched but not found)
    sessionProjectCache.set(sessionId, '');
    return null; // No matching project found
  } catch (error) {
    console.error("Error searching for project by session:", error);
    // Cache null result on error to avoid repeated errors
    sessionProjectCache.set(sessionId, '');
    return null;
  }
};
