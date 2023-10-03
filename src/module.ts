import {
  defineNuxtModule,
  createResolver,
  useLogger,
  addTemplate,
} from "@nuxt/kit";
import { Nuxt } from "@nuxt/schema";
import { emitArtifacts, loadConfigAndCreateContext } from "@pandacss/node";
import { findConfigFile } from "@pandacss/config";
import { promises as fsp, existsSync } from "node:fs";
import { Config } from "@pandacss/types";
import { resolveCSSPath } from "./resolvers";

const logger = useLogger("nuxt:pandacss");

export interface ModuleOptions extends Config {
  configPath?: string;
  /**
   * The path of the Panda CSS file.
   * @default '@/assets/css/global.css'
   */
  cssPath?: string;
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: "@wattanx/nuxt-pandacss",
    configKey: "pandacss",
  },
  // Default configuration options of the Nuxt module
  defaults: (nuxt) => ({
    preflight: true,
    include: [
      `${nuxt.options.srcDir}/components/**/*.{js,jsx,ts,tsx,vue}`,
      `${nuxt.options.srcDir}/pages/**/*.{js,jsx,ts,tsx,vue}`,
    ],
    exclude: [],
    outdir: "styled-system",
    cwd: nuxt.options.buildDir,
    cssPath: `@/${nuxt.options.dir.assets}/css/global.css`,
  }),
  async setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url);

    const cwd = resolve(options.cwd ?? nuxt.options.buildDir);

    // add alias
    nuxt.options.alias["styled-system"] = resolve(cwd, "styled-system");
    nuxt.options.alias["styled-system/*"] = resolve(cwd, "styled-system/*");

    if (existsSync(resolve(nuxt.options.buildDir, "panda.config.mjs"))) {
      await fsp.rm(resolve(nuxt.options.buildDir, "panda.config.mjs"));
    }

    let configPath = "";
    try {
      const configFile = findConfigFile({ cwd });

      configPath = configFile ?? addPandaConfigTemplate(cwd, options);
    } catch (e) {
      const dst = addPandaConfigTemplate(cwd, options);
      configPath = dst;
    }

    const postcssOptions = nuxt.options.postcss;
    postcssOptions.plugins["@pandacss/dev/postcss"] = postcssOptions.plugins[
      "@pandacss/dev/postcss"
    ] ?? {
      configPath,
    };

    const { resolvedCSSPath, loggerMessage } = await resolveCSSPath(
      options.cssPath,
      nuxt
    );
    nuxt.options.css.push(resolvedCSSPath);
    logger.info(loggerMessage);

    function loadContext() {
      return loadConfigAndCreateContext({
        cwd,
        config: { clean: options?.clean },
        configPath,
      });
    }

    async function createPandaContext() {
      const ctx = await loadContext();

      const { msg } = await emitArtifacts(ctx);

      logger.log(msg);
    }

    nuxt.hook("app:templatesGenerated", async () => {
      if (!nuxt.options._prepare) {
        await createPandaContext();
      }
    });

    nuxt.hook("prepare:types", async ({ tsConfig }) => {
      // require tsconfig.json for panda css
      const GeneratedBy = "// Generated by nuxt-pandacss";
      const tsConfigPath = resolve(nuxt.options.buildDir, "tsconfig.json");
      await fsp.mkdir(nuxt.options.buildDir, { recursive: true });
      await fsp.writeFile(
        tsConfigPath,
        GeneratedBy + "\n" + JSON.stringify(tsConfig, null, 2)
      );

      if (nuxt.options._prepare) {
        await createPandaContext();
      }
    });
  },
});

function addPandaConfigTemplate(cwd: string, options: ModuleOptions) {
  return addTemplate({
    filename: "panda.config.mjs",
    getContents: () => `
import { defineConfig } from "@pandacss/dev"
 
export default defineConfig(${JSON.stringify({ ...options, cwd }, null, 2)})`,
    write: true,
  }).dst;
}
