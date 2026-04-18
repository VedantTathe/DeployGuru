import { ProfileDescription } from "core/config/ProfileLifecycleManager";
import { KeyboardEvent as ReactKeyboardEvent } from "react";
import { getLocalStorage } from "./localStorage";

export type Platform = "mac" | "linux" | "windows" | "unknown";

export function getPlatform(): Platform {
  try {
    const userAgent = window.navigator.userAgent.toUpperCase();
    const platform = window.navigator.platform.toUpperCase();

    console.log("[DEBUG] [getPlatform] userAgent:", userAgent);
    console.log("[DEBUG] [getPlatform] platform:", platform);

    // Check user agent first (more reliable)
    if (userAgent.indexOf("MAC") >= 0 || userAgent.indexOf("DARWIN") >= 0) {
      console.log("[DEBUG] [getPlatform] Detected: MAC (from userAgent)");
      return "mac";
    } else if (userAgent.indexOf("LINUX") >= 0) {
      console.log("[DEBUG] [getPlatform] Detected: LINUX (from userAgent)");
      return "linux";
    } else if (userAgent.indexOf("WIN") >= 0) {
      console.log("[DEBUG] [getPlatform] Detected: WINDOWS (from userAgent)");
      return "windows";
    }

    // Fallback to navigator.platform if user agent check fails
    if (platform.indexOf("MAC") >= 0) {
      console.log("[DEBUG] [getPlatform] Detected: MAC (from platform)");
      return "mac";
    } else if (platform.indexOf("LINUX") >= 0) {
      console.log("[DEBUG] [getPlatform] Detected: LINUX (from platform)");
      return "linux";
    } else if (platform.indexOf("LINUX") >= 0 || platform.indexOf("X11") >= 0) {
      console.log("[DEBUG] [getPlatform] Detected: LINUX (from platform X11)");
      return "linux";
    } else if (platform.indexOf("WIN") >= 0) {
      console.log("[DEBUG] [getPlatform] Detected: WINDOWS (from platform)");
      return "windows";
    }

    console.log("[DEBUG] [getPlatform] Detected: UNKNOWN");
    return "unknown";
  } catch (e) {
    console.error("[DEBUG] [getPlatform] Error:", e);
    return "unknown";
  }
}

export function isMetaEquivalentKeyPressed({
  metaKey,
  ctrlKey,
}: KeyboardEvent | ReactKeyboardEvent): boolean {
  const platform = getPlatform();
  switch (platform) {
    case "mac":
      return metaKey;
    case "linux":
    case "windows":
      return ctrlKey;
    default:
      return metaKey;
  }
}

export function getMetaKeyLabel(): string {
  return getPlatform() === "mac" ? "⌘" : "Ctrl";
}

export function getAltKeyLabel(): string {
  const platform = getPlatform();
  switch (platform) {
    case "mac":
      return "⌥";
    default:
      return "Alt";
  }
}

export function getFontSize(): number {
  return getLocalStorage("fontSize") ?? (isJetBrains() ? 15 : 14);
}

export function fontSize(n: number): string {
  return `${getFontSize() + n}px`;
}

export function isJetBrains() {
  return getLocalStorage("ide") === "jetbrains";
}

export const isShareSessionSupported = () => !isJetBrains();

export function isWebEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    window.navigator &&
    window.navigator.userAgent.indexOf("Electron") === -1
  );
}

export function isPrerelease() {
  const extensionVersion = getLocalStorage("extensionVersion");
  if (!extensionVersion) {
    console.warn(
      `Could not find extension version in local storage, assuming it's a prerelease`,
    );
    return true;
  }
  const minor = parseInt(extensionVersion.split(".")[1], 10);
  if (minor % 2 !== 0) {
    return true;
  }
  return false;
}

export function isLocalProfile(profile: ProfileDescription): boolean {
  return profile.profileType === "local";
}
