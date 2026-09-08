import { TransformerConstructor } from "@/types/transformer";
import {
  LLMProvider,
  RegisterProviderRequest,
  ModelRoute,
  RequestRouteInfo,
  ConfigProvider,
} from "../types/llm";
import { ConfigService } from "./config"; 
import { TransformerService } from "./transformer";

const GATEWAY_MODEL_PREFIX = "claude-code-router/";

export interface GatewayModelRoute {
  provider: string;
  model: string;
  is1m: boolean;
}

/**
 * Claude Code only discovers gateway model IDs containing "claude" or
 * "anthropic". Base64url keeps arbitrary configured provider and model names
 * lossless while the prefix satisfies that discovery requirement.
 */
export const createGatewayModelId = (
  provider: string,
  model: string,
  is1m = false
): string =>
  `${GATEWAY_MODEL_PREFIX}${Buffer.from(provider).toString("base64url")}/${Buffer.from(model).toString("base64url")}${is1m ? "[1m]" : ""}`;

export const parseGatewayModelId = (modelId: string): GatewayModelRoute | null => {
  const is1m = /\[1m\]$/i.test(modelId);
  const normalizedModelId = is1m ? modelId.slice(0, -4) : modelId;
  if (!normalizedModelId.startsWith(GATEWAY_MODEL_PREFIX)) {
    return null;
  }

  const encodedRoute = normalizedModelId.slice(GATEWAY_MODEL_PREFIX.length).split("/");
  if (encodedRoute.length !== 2 || !encodedRoute[0] || !encodedRoute[1]) {
    return null;
  }

  try {
    const provider = Buffer.from(encodedRoute[0], "base64url").toString("utf8");
    const model = Buffer.from(encodedRoute[1], "base64url").toString("utf8");
    return provider && model ? { provider, model, is1m } : null;
  } catch {
    return null;
  }
};

export class ProviderService {
  private providers: Map<string, LLMProvider> = new Map();
  private modelRoutes: Map<string, ModelRoute> = new Map();

  constructor(private readonly configService: ConfigService, private readonly transformerService: TransformerService, private readonly logger: any) {
    this.initializeCustomProviders();
  }

  private initializeCustomProviders() {
    const providersConfig =
      this.configService.get<ConfigProvider[]>("providers");
    if (providersConfig && Array.isArray(providersConfig)) {
      this.initializeFromProvidersArray(providersConfig);
      return;
    }
  }

  private initializeFromProvidersArray(providersConfig: ConfigProvider[]) {
    providersConfig.forEach((providerConfig: ConfigProvider) => {
      try {
        if (
          !providerConfig.name ||
          !providerConfig.api_base_url ||
          !providerConfig.api_key
        ) {
          return;
        }

        const transformer: LLMProvider["transformer"] = {}

        if (providerConfig.transformer) {
          Object.keys(providerConfig.transformer).forEach(key => {
            if (key === 'use') {
              if (Array.isArray(providerConfig.transformer.use)) {
                transformer.use = providerConfig.transformer.use.map((transformer) => {
                  if (Array.isArray(transformer) && typeof transformer[0] === 'string') {
                    const Constructor = this.transformerService.getTransformer(transformer[0]);
                    if (Constructor) {
                      return new (Constructor as TransformerConstructor)(transformer[1]);
                    }
                  }
                  if (typeof transformer === 'string') {
                    const transformerInstance = this.transformerService.getTransformer(transformer);
                    if (typeof transformerInstance === 'function') {
                      return new transformerInstance();
                    }
                    return transformerInstance;
                  }
                }).filter((transformer) => typeof transformer !== 'undefined');
              }
            } else {
              if (Array.isArray(providerConfig.transformer[key]?.use)) {
                transformer[key] = {
                  use: providerConfig.transformer[key].use.map((transformer) => {
                    if (Array.isArray(transformer) && typeof transformer[0] === 'string') {
                      const Constructor = this.transformerService.getTransformer(transformer[0]);
                      if (Constructor) {
                        return new (Constructor as TransformerConstructor)(transformer[1]);
                      }
                    }
                    if (typeof transformer === 'string') {
                      const transformerInstance = this.transformerService.getTransformer(transformer);
                      if (typeof transformerInstance === 'function') {
                        return new transformerInstance();
                      }
                      return transformerInstance;
                    }
                  }).filter((transformer) => typeof transformer !== 'undefined')
                }
              }
            }
          })
        }

        this.registerProvider({
          name: providerConfig.name,
          baseUrl: providerConfig.api_base_url,
          apiKey: providerConfig.api_key,
          models: providerConfig.models || [],
          models_1m: providerConfig.models_1m || [],
          transformer: providerConfig.transformer ? transformer : undefined,
        });

        this.logger.info(`${providerConfig.name} provider registered`);
      } catch (error) {
        this.logger.error(`${providerConfig.name} provider registered error: ${error}`);
      }
    });
  }

  registerProvider(request: RegisterProviderRequest): LLMProvider {
    const provider: LLMProvider = {
      ...request,
    };

    this.providers.set(provider.name, provider);

    request.models.forEach((model) => {
      const fullModel = `${provider.name},${model}`;
      const route: ModelRoute = {
        provider: provider.name,
        model,
        fullModel,
      };
      this.modelRoutes.set(fullModel, route);
      if (!this.modelRoutes.has(model)) {
        this.modelRoutes.set(model, route);
      }
    });

    return provider;
  }

  getProviders(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  getProvider(name: string): LLMProvider | undefined {
    return this.providers.get(name);
  }

  updateProvider(
    id: string,
    updates: Partial<LLMProvider>
  ): LLMProvider | null {
    const provider = this.providers.get(id);
    if (!provider) {
      return null;
    }

    const updatedProvider = {
      ...provider,
      ...updates,
      updatedAt: new Date(),
    };

    this.providers.set(id, updatedProvider);

    if (updates.models) {
      provider.models.forEach((model) => {
        const fullModel = `${provider.name},${model}`;
        this.modelRoutes.delete(fullModel);
        this.modelRoutes.delete(model);
      });

      updates.models.forEach((model) => {
        const fullModel = `${provider.name},${model}`;
        const route: ModelRoute = {
          provider: provider.name,
          model,
          fullModel,
        };
        this.modelRoutes.set(fullModel, route);
        if (!this.modelRoutes.has(model)) {
          this.modelRoutes.set(model, route);
        }
      });
    }

    return updatedProvider;
  }

  deleteProvider(id: string): boolean {
    const provider = this.providers.get(id);
    if (!provider) {
      return false;
    }

    provider.models.forEach((model) => {
      const fullModel = `${provider.name},${model}`;
      this.modelRoutes.delete(fullModel);
      this.modelRoutes.delete(model);
    });

    this.providers.delete(id);
    return true;
  }

  toggleProvider(name: string, enabled: boolean): boolean {
    const provider = this.providers.get(name);
    if (!provider) {
      return false;
    }
    return true;
  }

  resolveModelRoute(modelName: string): RequestRouteInfo | null {
    const route = this.modelRoutes.get(modelName);
    if (!route) {
      return null;
    }

    const provider = this.providers.get(route.provider);
    if (!provider) {
      return null;
    }

    return {
      provider,
      originalModel: modelName,
      targetModel: route.model,
    };
  }

  getAvailableModelNames(): string[] {
    const modelNames: string[] = [];
    this.providers.forEach((provider) => {
      provider.models.forEach((model) => {
        modelNames.push(model);
        modelNames.push(`${provider.name},${model}`);
      });
    });
    return modelNames;
  }

  getModelRoutes(): ModelRoute[] {
    return Array.from(this.modelRoutes.values());
  }

  private parseTransformerConfig(transformerConfig: any): any {
    if (!transformerConfig) return {};

    if (Array.isArray(transformerConfig)) {
      return transformerConfig.reduce((acc, item) => {
        if (Array.isArray(item)) {
          const [name, config = {}] = item;
          acc[name] = config;
        } else {
          acc[item] = {};
        }
        return acc;
      }, {});
    }

    return transformerConfig;
  }

  async getAvailableModels(): Promise<{
    object: string;
    data: Array<{
      id: string;
      object: string;
      owned_by: string;
      provider: string;
    }>;
  }> {
    const models: Array<{
      id: string;
      object: string;
      owned_by: string;
      provider: string;
    }> = [];

    this.providers.forEach((provider) => {
      provider.models.forEach((model) => {
        models.push({
          id: model,
          object: "model",
          owned_by: provider.name,
          provider: provider.name,
        });

        models.push({
          id: `${provider.name},${model}`,
          object: "model",
          owned_by: provider.name,
          provider: provider.name,
        });
      });
    });

    return {
      object: "list",
      data: models,
    };
  }

  getGatewayModels(): {
    object: string;
    data: Array<{
      id: string;
      type: string;
      display_name: string;
      description: string;
    }>;
    has_more: boolean;
  } {
    const models = this.getProviders().flatMap((provider) =>
      provider.models.flatMap((model) => {
        const modelEntry = {
          id: createGatewayModelId(provider.name, model),
          type: "model",
          display_name: `${provider.name}, ${model}`,
          description: `CCR model: ${provider.name},${model}`,
        };
        const supports1m = provider.models_1m?.some(
          (model1m) => model1m.toLowerCase() === model.toLowerCase()
        );
        return supports1m
          ? [
              modelEntry,
              {
                id: createGatewayModelId(provider.name, model, true),
                type: "model",
                display_name: `${provider.name}, ${model} [1M]`,
                description: `CCR model: ${provider.name},${model} (1M context)`,
              },
            ]
          : [modelEntry];
      })
    );

    return {
      object: "list",
      data: models,
      has_more: false,
    };
  }
}
