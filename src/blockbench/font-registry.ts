import {
  DEFAULT_FONT_DATA_URL,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_FORMAT,
  DEFAULT_FONT_HASH,
  DEFAULT_FONT_ID,
  DEFAULT_FONT_NAME,
} from '../assets/minecraft-font';
import { t } from './i18n';

export interface BBTextFontResource {
  id: string;
  name: string;
  family: string;
  format: 'ttf' | 'otf' | string;
  hash: string;
  data_url: string;
}

const GLOBAL_FONT_STORAGE_KEY = 'bbmodel_text_component.fonts';
const loadedFonts = new Map<string, Promise<string>>();
let projectFontProperty: any | undefined;

export const DEFAULT_FONT: BBTextFontResource = {
  id: DEFAULT_FONT_ID,
  name: DEFAULT_FONT_NAME,
  family: DEFAULT_FONT_FAMILY,
  format: DEFAULT_FONT_FORMAT,
  hash: DEFAULT_FONT_HASH,
  data_url: DEFAULT_FONT_DATA_URL,
};

export function registerProjectFontProperty(): void {
  if (typeof ModelProject === 'undefined') return;
  if (!ModelProject.properties?.bb_text_fonts) {
    projectFontProperty = new Property(ModelProject, 'array', 'bb_text_fonts', { default: [] });
  }
}

export function unregisterProjectFontProperty(): void {
  projectFontProperty?.delete?.();
  projectFontProperty = undefined;
}

function uniqueFonts(fonts: BBTextFontResource[]): BBTextFontResource[] {
  const seen = new Set<string>();
  const result: BBTextFontResource[] = [];
  for (const font of fonts) {
    if (!font?.id || seen.has(font.id)) continue;
    seen.add(font.id);
    result.push(font);
  }
  return result;
}

export function getProjectFonts(): BBTextFontResource[] {
  if (!Project) return [DEFAULT_FONT];
  if (!Array.isArray(Project.bb_text_fonts)) Project.bb_text_fonts = [];
  if (!Project.bb_text_fonts.some((font: BBTextFontResource) => font.id === DEFAULT_FONT.id)) {
    Project.bb_text_fonts.unshift({ ...DEFAULT_FONT });
  }
  return Project.bb_text_fonts;
}

export function setProjectFonts(fonts: BBTextFontResource[]): void {
  if (!Project) return;
  Project.bb_text_fonts = uniqueFonts(fonts);
  Project.saved = false;
}

export function getGlobalFonts(): BBTextFontResource[] {
  try {
    const raw = localStorage.getItem(GLOBAL_FONT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? uniqueFonts(parsed) : [];
  } catch (error) {
    console.warn('[BBText] Failed to read global font library', error);
    return [];
  }
}

export function setGlobalFonts(fonts: BBTextFontResource[]): void {
  try {
    localStorage.setItem(GLOBAL_FONT_STORAGE_KEY, JSON.stringify(uniqueFonts(fonts)));
  } catch (error) {
    console.warn('[BBText] Failed to persist global font library', error);
    Blockbench.showQuickMessage(t('bb_text.message.global_font_storage_full'));
  }
}

export function getAllFonts(): BBTextFontResource[] {
  return uniqueFonts([...getProjectFonts(), ...getGlobalFonts(), DEFAULT_FONT]);
}

export function getFontOptions(): Record<string, string> {
  const options: Record<string, string> = {};
  for (const font of getAllFonts()) {
    options[font.id] = getFontDisplayName(font);
  }
  return options;
}

export function getFontDisplayName(font: BBTextFontResource): string {
  return font.id === DEFAULT_FONT.id ? t('bb_text.font.default_minecraft') : font.name;
}

export function resolveFontResource(fontId?: string): BBTextFontResource {
  const match = getAllFonts().find(font => font.id === fontId);
  return match || DEFAULT_FONT;
}

function sanitizeFamily(value: string): string {
  return `BBText_${String(value || 'Font').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export async function loadFontFamily(fontId?: string): Promise<string> {
  const resource = resolveFontResource(fontId);
  if (loadedFonts.has(resource.id)) return loadedFonts.get(resource.id)!;

  const promise = (async () => {
    const family = sanitizeFamily(resource.family || `${resource.name}_${resource.hash.slice(0, 8)}`);
    if (typeof FontFace === 'undefined' || !resource.data_url) return 'monospace';
    const face = new FontFace(family, `url(${resource.data_url})`);
    const loaded = await face.load();
    (document.fonts as any).add(loaded);
    return family;
  })().catch(error => {
    console.warn(`[BBText] Failed to load font ${resource.name}`, error);
    return 'monospace';
  });

  loadedFonts.set(resource.id, promise);
  return promise;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  if (crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  let hash = 0;
  for (const byte of new Uint8Array(buffer)) hash = ((hash << 5) - hash + byte) | 0;
  return `fallback_${Math.abs(hash).toString(16)}`;
}

function fileStem(name: string): string {
  return String(name || t('bb_text.font.imported')).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || t('bb_text.font.imported');
}

export async function createFontFromFile(file: { name: string; content: ArrayBuffer }): Promise<BBTextFontResource> {
  const ext = (file.name.split('.').pop() || 'otf').toLowerCase();
  const format = ext === 'ttf' ? 'ttf' : 'otf';
  const hash = await sha256(file.content);
  const name = fileStem(file.name);
  return {
    id: `font_${hash.slice(0, 16)}`,
    name,
    family: sanitizeFamily(`${name}_${hash.slice(0, 8)}`),
    format,
    hash,
    data_url: `data:font/${format};base64,${bufferToBase64(file.content)}`,
  };
}

export function addFontToProjectAndLibrary(font: BBTextFontResource): void {
  const projectFonts = getProjectFonts();
  setProjectFonts(uniqueFonts([font, ...projectFonts]));
  const globalFonts = getGlobalFonts();
  setGlobalFonts(uniqueFonts([font, ...globalFonts]));
}

export function refreshFontSelectOptions(): void {
  const property = (globalThis as any).BBTextElement?.properties?.font_id;
  if (property?.inputs?.element_panel?.input) {
    property.inputs.element_panel.input.options = getFontOptions();
  }
  try {
    Interface?.Panels?.element?.form?.buildForm?.();
    updateSelection();
  } catch {
    // The element panel may not be initialized yet.
  }
}
