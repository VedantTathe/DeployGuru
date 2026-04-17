const fs = require("fs");
const path = require("path");

const { writeBuildTimestamp } = require("./utils");

const esbuild = require("esbuild");

const flags = process.argv.slice(2);

function copySqliteNativeBindingsIfAvailable() {
  const sqliteBuildDir = "../../core/node_modules/sqlite3/build";
  const sqliteBinary = `${sqliteBuildDir}/Release/node_sqlite3.node`;

  if (!fs.existsSync(sqliteBinary)) {
    console.warn(
      "[warn] sqlite3 native binary not found in core; skipping sqlite binding copy",
    );
    return;
  }

  fs.mkdirSync("build", { recursive: true });
  fs.mkdirSync("out", { recursive: true });

  // Keep both legacy lookup paths populated for extension host activation.
  fs.cpSync(sqliteBuildDir, "build", { recursive: true });
  fs.cpSync(sqliteBuildDir, "out", { recursive: true });

  // Also populate direct/native lookup locations used by bindings().
  fs.copyFileSync(sqliteBinary, "build/node_sqlite3.node");
  fs.copyFileSync(sqliteBinary, "out/node_sqlite3.node");

  const bindingDir = path.join(
    "lib",
    "binding",
    `node-v${process.versions.modules}-${process.platform}-${process.arch}`,
  );
  fs.mkdirSync(bindingDir, { recursive: true });
  fs.copyFileSync(sqliteBinary, path.join(bindingDir, "node_sqlite3.node"));
}

const esbuildConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: ["vscode", "esbuild", "./xhr-sync-worker.js"],
  format: "cjs",
  platform: "node",
  sourcemap: flags.includes("--sourcemap"),
  loader: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    ".node": "file",
  },

  // To allow import.meta.path for transformers.js
  // https://github.com/evanw/esbuild/issues/1492#issuecomment-893144483
  inject: ["./scripts/importMetaUrl.js"],
  define: { "import.meta.url": "importMetaUrl" },
  supported: { "dynamic-import": false },
  metafile: true,
  plugins: [
    {
      name: "on-end-plugin",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length > 0) {
            console.error("Build failed with errors:", result.errors);
            throw new Error(result.errors);
          } else {
            try {
              fs.writeFileSync(
                "./build/meta.json",
                JSON.stringify(result.metafile, null, 2),
              );
            } catch (e) {
              console.error("Failed to write esbuild meta file", e);
            }
            console.log("VS Code Extension esbuild complete"); // used verbatim in vscode tasks to detect completion
          }
        });
      },
    },
  ],
};

void (async () => {
  copySqliteNativeBindingsIfAvailable();

  // Create .buildTimestamp.js before starting the first build
  writeBuildTimestamp();
  // Bundles the extension into one file
  if (flags.includes("--watch")) {
    const ctx = await esbuild.context(esbuildConfig);
    await ctx.watch();
  } else if (flags.includes("--notify")) {
    const inFile = esbuildConfig.entryPoints[0];
    const outFile = esbuildConfig.outfile;

    // The watcher automatically notices changes to source files
    // so the only thing it needs to be notified about is if the
    // output file gets removed.
    if (fs.existsSync(outFile)) {
      console.log("VS Code Extension esbuild up to date");
      return;
    }

    fs.watchFile(outFile, (current, previous) => {
      if (current.size > 0) {
        console.log("VS Code Extension esbuild rebuild complete");
        fs.unwatchFile(outFile);
        process.exit(0);
      }
    });

    console.log("Triggering VS Code Extension esbuild rebuild...");
    writeBuildTimestamp();
  } else {
    await esbuild.build(esbuildConfig);
  }
})();
