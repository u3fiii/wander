import { useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, CompositionEvent, KeyboardEvent } from 'react';
import { englishNameInput, englishPhysicalKey } from './game/nameInput';

// lang/inputMode hint at English text entry; mobile OSes still own keyboard
// language. Character conversion also handles mobile keyboards and pasted text.
export default function EnglishNameInput({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [draft, setDraft] = useState<string | null>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caret.current !== null && input.current) {
      input.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });
  const commit = (text: string, position: number) => {
    caret.current = englishNameInput(text.slice(0, position)).length;
    onChange(englishNameInput(text));
  };
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    if (composing.current) { setDraft(event.target.value); return; }
    commit(event.target.value, event.target.selectionStart ?? event.target.value.length);
  };
  const compositionEnd = (event: CompositionEvent<HTMLInputElement>) => {
    composing.current = false;
    setDraft(null);
    commit(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || composing.current) return;
    const letter = englishPhysicalKey(event.key, event.code, event.shiftKey);
    if (!letter) return;
    event.preventDefault();
    const field = event.currentTarget;
    const start = field.selectionStart ?? value.length;
    const end = field.selectionEnd ?? start;
    if (value.length - (end - start) >= 8) return;
    commit(value.slice(0, start) + letter + value.slice(end), start + 1);
  };
  return <input ref={input} id="run-name-input" autoFocus type="text" lang="en" dir="ltr" inputMode="text"
    maxLength={8} pattern="[A-Za-z ]{1,8}" autoComplete="nickname" autoCapitalize="none" autoCorrect="off"
    spellCheck={false} placeholder="Your name" value={draft ?? value} onChange={change} onKeyDown={keyDown}
    onCompositionStart={() => { composing.current = true; setDraft(value); }} onCompositionEnd={compositionEnd} />;
}
