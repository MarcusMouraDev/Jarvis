import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";

const [, , targetArg, templateArg] = process.argv;
if (!targetArg || !templateArg) {
  throw new Error("usage: configure-hermes-broker.mjs TARGET TEMPLATE");
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const target = path.resolve(targetArg);
const template = record(parse(readFileSync(path.resolve(templateArg), "utf8")));
const current = existsSync(target)
  ? record(parse(readFileSync(target, "utf8")))
  : {};
const templateModel = record(template.model);
const templateProviders = record(template.providers);
const merged = {
  ...current,
  model: { ...record(current.model), ...templateModel },
  providers: {
    ...record(current.providers),
    "jarvis-broker": record(templateProviders["jarvis-broker"]),
  },
};

mkdirSync(path.dirname(target), { recursive: true });
const temporary = `${target}.tmp-${process.pid}`;
try {
  writeFileSync(temporary, stringify(merged), {
    mode: existsSync(target) ? statSync(target).mode : 0o644,
  });
  renameSync(temporary, target);
} finally {
  rmSync(temporary, { force: true });
}
