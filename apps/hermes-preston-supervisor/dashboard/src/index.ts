// Preston Supervisor - Hermes dashboard plugin entry. Built as a
// single IIFE bundle (see build.mjs); React and all UI primitives
// come from window.__HERMES_PLUGIN_SDK__ - nothing is bundled.
// Registration name MUST match manifest.json "name".

import { PrestonTab } from "./ui/tab";

const PLUGIN_NAME = "preston-supervisor";

function register(): void {
  const registry = window.__HERMES_PLUGINS__;
  if (!registry || typeof registry.register !== "function") {
    // The shell registers plugins within 2s of script load; if the
    // registry is missing the shell will report the timeout itself.
    return;
  }
  registry.register(PLUGIN_NAME, PrestonTab);
}

register();
