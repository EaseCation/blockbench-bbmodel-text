import { textData, renderKey, hash } from '../core/model';
import { getProjectFonts, fontStore, embedFont } from './font-registry';
import { measureText, prepareText, rasterText, readyText } from './text-renderer';
import { studioApi, fingerprint } from './carrier';
let off: (() => void) | undefined;
let connected: any;
export function connectStudio(edit: (id: string) => void) {
  const connect = () => {
    const api = studioApi();
    if (!api || api === connected) return;
    off?.();
    connected = api;
    off = api.register({
      id: 'bb_text',
      title: '文字 / Text',
      icon: 'text_fields',
      prepare: (data: any) => prepareText(textData(data)),
      ready: (data: any) => readyText(textData(data)),
      key: (data: any) => hash(renderKey(textData(data))),
      measure: (data: any, width?: number) => {
        const size = measureText(textData(data), width);
        return { width: Math.ceil(size.width), height: Math.ceil(size.height) };
      },
      render: (data: any, size: any) => rasterText(textData(data), size),
      edit,
      fallback: (id: string) => {
        const p = Cube.all.find((c: any) => c.uuid === id)?.bb_text_transfer?.pixels;
        return p ? { ...p, data: new Uint8ClampedArray(p.data) } : null;
      },
      seal: (id: string, data: any) => {
        embedFont(data.font_id);
        const cube = Cube.all.find((c: any) => c.uuid === id);
        return cube ? { fingerprint: fingerprint(cube) } : {};
      },
      resources: () => structuredClone(getProjectFonts()),
      importResources: (fonts: any[]) => {
        const store = fontStore();
        for (const font of fonts || [])
          if (font?.id && font?.data_url && !store.fonts.some((f: any) => f.hash === font.hash))
            store.fonts.push(structuredClone(font));
      },
    });
  };
  Blockbench.on('mcui_content_api_ready', connect);
  Blockbench.on('loaded_plugin', connect);
  connect();
  return () => {
    off?.();
    off = undefined;
    connected = null;
    Blockbench.removeListener('mcui_content_api_ready', connect);
    Blockbench.removeListener('loaded_plugin', connect);
  };
}
