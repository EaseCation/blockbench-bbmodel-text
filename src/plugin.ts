import { getProjectFonts, registerProjectFontProperty, unregisterProjectFontProperty } from './blockbench/font-registry';
import { registerProjectSettingsProperties, unregisterProjectSettingsProperties } from './blockbench/settings';
import { registerTextElement, refreshAllTextElements, unregisterTextElement } from './blockbench/text-element';
import { registerActions, unregisterActions } from './blockbench/actions';
import { registerBBTextTranslations, t } from './blockbench/i18n';

const listeners: Array<{ event: string; handler: (...args: any[]) => void }> = [];

function addListener(event: string, handler: (...args: any[]) => void): void {
  listeners.push({ event, handler });
  Blockbench.on(event, handler);
}

function removeListeners(): void {
  for (const { event, handler } of listeners) {
    try { Blockbench.removeListener?.(event, handler); } catch {}
  }
  listeners.length = 0;
}

function syncProjectFontsAndPreview(): void {
  if (!Project) return;
  getProjectFonts();
  setTimeout(() => refreshAllTextElements(), 0);
}

export function registerPlugin(): void {
  registerBBTextTranslations();
  BBPlugin.register('bbmodel-text-component', {
    title: t('bb_text.plugin.title'),
    name: t('bb_text.plugin.title'),
    author: 'EaseCation',
    description: t('bb_text.plugin.description'),
    version: '0.1.0',
    variant: 'both',
    min_version: '5.0.0',
    tags: ['Minecraft', 'Text', 'BBModel'],
    icon: 'text_fields',
    onload() {
      registerProjectFontProperty();
      registerProjectSettingsProperties();
      registerTextElement();
      registerActions();
      addListener('setup_project', syncProjectFontsAndPreview);
      addListener('load_project', syncProjectFontsAndPreview);
      addListener('select_project', syncProjectFontsAndPreview);
      syncProjectFontsAndPreview();
    },
    onunload() {
      removeListeners();
      unregisterActions();
      unregisterTextElement();
      unregisterProjectSettingsProperties();
      unregisterProjectFontProperty();
    },
  });
}
