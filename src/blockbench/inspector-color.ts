/** Native Spectrum input previews locally and commits once on close. */
export function inspectorColor(
  picker: any,
  read: () => { key: string; color: string } | null,
  commit: (color: string) => void,
) {
  let opened = false,
    cancelling = false,
    start: ReturnType<typeof read> = null,
    shown = '';
  const cancel = () => {
    cancelling = true;
    picker.hide();
    cancelling = false;
  };
  const escape = (event: KeyboardEvent) => {
    if (opened && event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    }
  };
  document.addEventListener('keydown', escape, true);
  const keys = Blockbench.on('press_key', (data: any) => {
    if (opened && !data.input_in_focus && !['Enter', 'Escape', 'Tab'].includes(data.event.key))
      data.capture();
  });
  const show = () => {
    opened = true;
    start = read();
    shown = picker.get().toHex8String();
  };
  const hide = () => {
    if (!opened) return;
    opened = false;
    const next = picker.get().toHex8String(),
      current = read();
    if (
      !cancelling &&
      start &&
      current?.key === start.key &&
      current.color === start.color &&
      next !== shown
    )
      commit(next);
    else if (current) picker.set(current.color);
  };
  picker.onChange = () => {};
  picker.jq.on('show.spectrum', show);
  picker.jq.on('hide.spectrum', hide);
  return {
    isOpen: () => opened,
    refresh() {
      const current = read();
      if (opened && (current?.key !== start?.key || current?.color !== start?.color)) cancel();
    },
    dispose() {
      cancel();
      document.removeEventListener('keydown', escape, true);
      keys.delete();
      picker.jq.off('show.spectrum', show);
      picker.jq.off('hide.spectrum', hide);
    },
  };
}
