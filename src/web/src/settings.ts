import { localizeMarkup } from "./language";

const graphics = {
  low: {
    pixelRatio: 1, glowLimit: 32, halo: [{ width: 3, opacity: .2 }],
    nodeGlow: "flat", nodeLight: 0, animate: false
  },
  balanced: {
    pixelRatio: 2, glowLimit: 96, halo: [{ width: 8, opacity: .14 }, { width: 4, opacity: .32 }],
    nodeGlow: "soft", nodeLight: .25, animate: true
  },
  high: {
    pixelRatio: 3, glowLimit: 220,
    halo: [{ width: 22, opacity: .07 }, { width: 14, opacity: .13 }, { width: 8, opacity: .25 }, { width: 4, opacity: .42 }],
    nodeGlow: "layered", nodeLight: .65, animate: true
  }
} as const;
export const defaultGraphics = graphics.balanced;
const themes = ["light", "dark", "purple"] as const;
const languages = ["en", "ru"] as const;
const cookieName = "CodeOrganism.Preferences";

export type GraphicsQuality = typeof graphics[keyof typeof graphics];
type Preferences = {
  graphics: keyof typeof graphics;
  language: typeof languages[number];
  theme: typeof themes[number];
};

function validated(value: unknown): Preferences {
  const data: Partial<Preferences> = value && typeof value === "object" ? value : {};
  return {
    graphics: data.graphics && Object.hasOwn(graphics, data.graphics) ? data.graphics : "balanced",
    language: data.language && languages.includes(data.language) ? data.language : "en",
    theme: data.theme && themes.includes(data.theme) ? data.theme : "purple"
  };
}

function loadPreferences() {
  try {
    const entry = document.cookie.split("; ").find(part => part.startsWith(cookieName + "="));
    return validated(entry ? JSON.parse(decodeURIComponent(entry.slice(cookieName.length + 1))) : undefined);
  } catch {
    return validated(undefined);
  }
}

export function connectSettings(onChange: (quality: GraphicsQuality, languageChanged: boolean) => void) {
  const dialog = document.querySelector<HTMLDialogElement>("#settings")!;
  const button = document.querySelector<HTMLButtonElement>("#open-settings")!;
  const quality = document.querySelector<HTMLSelectElement>("#graphics-quality")!;
  const language = document.querySelector<HTMLSelectElement>("#language")!;
  const theme = document.querySelector<HTMLSelectElement>("#theme")!;
  const translate = localizeMarkup();

  function apply(preferences: Preferences) {
    const languageChanged = document.documentElement.lang !== preferences.language;
    document.documentElement.lang = preferences.language;
    document.documentElement.dataset.theme = preferences.theme;
    quality.value = preferences.graphics;
    language.value = preferences.language;
    theme.value = preferences.theme;
    if (languageChanged) translate();
    onChange(graphics[preferences.graphics], languageChanged);
  }

  function change() {
    const preferences = validated({ graphics: quality.value, language: language.value, theme: theme.value });
    apply(preferences);
    // The loopback URL uses an ephemeral port. Cookies are scoped to the host across ports.
    document.cookie = `${cookieName}=${encodeURIComponent(JSON.stringify(preferences))}; Path=/; Max-Age=31536000; SameSite=Strict`;
  }

  button.addEventListener("click", () => dialog.showModal());
  dialog.addEventListener("close", () => button.focus());
  for (const field of [quality, language, theme]) field.addEventListener("change", change);
  apply(loadPreferences());
}
