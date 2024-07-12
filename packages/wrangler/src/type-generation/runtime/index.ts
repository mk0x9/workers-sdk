import { readFileSync } from "fs";
import { writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { Miniflare } from "miniflare";
import { logger } from "../../logger";
import { getBasePath } from "../../paths";
import { ensureDirectoryExists } from "../../utils/log-file";
import type { Config } from "../../config/config";

const OUTFILE_RELATIVE_PATH = "./.wrangler/types/runtime.d.ts";

/**
 * Generates runtime types for a Workers project based on the provided project configuration.
 *
 * This function is designed to be isolated and portable, making it easy to integrate into various
 * build processes or development workflows. It handles the whole process of generating runtime
 * types, from ensuring the output directory exists to spawning the workerd process (via Miniflare)
 * and writing the generated types to a file.
 *
 * @param {string} configPath - The path to the wrangler.toml file.
 * @param {Config} config - The parsed config object.
 *
 * @throws {Error} If the config file does not have a compatibility date.
 *
 * @example
 * import { generateRuntimeTypes } from './path/to/this/file';
 * import { readConfig } from './path/to/config';
 *
 * const configPath = './wrangler.toml';
 * const config = readConfig(configPath);
 *
 * await generateRuntimeTypes(configPath, config);
 * // This will generate runtime types and write them to ./.wrangler/types/runtime.d.ts
 *
 * @remarks
 * - The generated types are written to a file specified by OUTFILE_RELATIVE_PATH.
 * - This could be improved by hashing the compat date and flags to avoid unnecessary regeneration.
 */
export async function generateRuntimeTypes(rootPath: string, config: Config) {
	const { compatibility_date, compatibility_flags } = config;

	if (!compatibility_date) {
		throw new Error("Config must have a compatability date.");
	}
	const configDir = dirname(rootPath);
	const outfileRelative = OUTFILE_RELATIVE_PATH;
	const outfileAbsolute = resolve(configDir, outfileRelative);

	await ensureDirectoryExists(outfileAbsolute);

	logger.log("Generating runtime types");
	await generate({
		outfilePath: outfileAbsolute,
		compatibilityDate: compatibility_date,
		compatibilityFlags: compatibility_flags,
	});
	logger.log(`Runtime types generated and written to ${outfileRelative} \n`);
}

/**
 * Generates runtime types for Cloudflare Workers by spawning a workerd process with the type-generation
 * worker, and then making a request to that worker to fetch types.
 *
 * @param {Object} options - The options for type generation.
 * @param {string} options.outfilePath - The absolute path where the generated types will be written.
 * @param {string} options.compatibilityDate - The compatibility date for the Workers runtime.
 * @param {string[]} [options.compatibilityFlags=[]] - Optional compatibility flags.
 *
 * @throws {Error} If the workerd process fails to start or if the server doesn't respond after multiple retries.
 */
export async function generate({
	outfilePath,
	compatibilityDate,
	compatibilityFlags = [],
}: {
	outfilePath: string;
	compatibilityDate: string;
	compatibilityFlags?: string[];
}) {
	const workerScript = readFileSync(
		resolve(getBasePath(), "../../../workerd/bazel-bin/types/dist/index.mjs")
	).toString();

	const mf = new Miniflare({
		compatibilityDate: "2024-01-01",
		compatibilityFlags: ["nodejs_compat", "rtti_api"],
		modules: true,
		script: workerScript,
	});

	const flagsString = compatibilityFlags.length
		? `+${compatibilityFlags.join("+")}`
		: "";
	const path = `http://dummy.com/${compatibilityDate}${flagsString}`;

	const res = await mf.dispatchFetch(path);
	const content = await res.text();

	await Promise.all([writeFile(outfilePath, content, "utf8"), mf.dispose()]);
}
