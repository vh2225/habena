export function expandEnv(
  value: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string {
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name) => {
    const v = env[name];
    return v ?? "";
  });
}

export function expandEnvInConfig<T>(
  config: T,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): T {
  if (typeof config === "string") {
    return expandEnv(config, env) as unknown as T;
  }
  if (Array.isArray(config)) {
    return config.map((item) => expandEnvInConfig(item, env)) as unknown as T;
  }
  if (config && typeof config === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(config)) {
      result[k] = expandEnvInConfig(v, env);
    }
    return result as T;
  }
  return config;
}
