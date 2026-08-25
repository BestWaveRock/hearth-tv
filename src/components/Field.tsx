import { useEffect, useId, useRef, useState } from 'react';
import { FocusScope, useFocusable } from '../focus';
import { input } from '../input/manager';
import { useDismissable } from '../lib/dismiss';
import { useT } from '../lib/i18n';
import { Button, cx } from './primitives';

/* ======================================================================== *
 * On-screen keyboard
 *
 * The whole point of this product is that a remote is enough, and a remote
 * cannot type. So text entry gets a real keyboard: a D-pad-navigable grid,
 * plus two shortcuts that matter here — a URL row, because every setup screen
 * asks for a server address, and phone hand-off, because nobody should enter a
 * 30-character WebDAV password one arrow press at a time.
 * ======================================================================== */

const LETTER_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl-', 'zxcvbnm.@_'];
const SYMBOL_ROWS = ['1234567890', '!"#$%&\'()*', '+,-./:;<=>', '?@[]^_{|}~'];

export type KeyboardKind = 'text' | 'url' | 'password' | 'search';

interface OnScreenKeyboardProps {
  title: string;
  initial: string;
  kind?: KeyboardKind;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

export function OnScreenKeyboard({
  title,
  initial,
  kind = 'text',
  placeholder,
  onCommit,
  onCancel,
}: OnScreenKeyboardProps) {
  const t = useT();
  const [value, setValue] = useState(initial);
  const [shift, setShift] = useState(initial.length === 0 && kind === 'text');
  const [symbols, setSymbols] = useState(false);
  const [reveal, setReveal] = useState(kind !== 'password');

  // Back closes the keyboard rather than navigating the screen behind it.
  useDismissable(onCancel);

  // Text typed on a paired phone lands straight in the field.
  useEffect(() => input.phone.onText((text) => setValue((v) => v + text)), []);

  const rows = symbols ? SYMBOL_ROWS : LETTER_ROWS;
  const display = reveal ? value : '•'.repeat(value.length);

  const append = (ch: string) => {
    setValue((v) => v + (shift && !symbols ? ch.toUpperCase() : ch));
    if (shift) setShift(false);
  };

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label={title}>
      <FocusScope name="osk">
        <div className="dialog glass panel">
          <div className="stack stack-xs">
            <p className="t-label">{title}</p>
            <div className="osk__preview">
              <span className="grow" style={{ overflowWrap: 'anywhere' }}>
                {display || <span className="faint">{placeholder ?? t('field.typeHere')}</span>}
              </span>
              <span className="osk__caret" aria-hidden="true" />
            </div>
          </div>

          {kind === 'url' ? (
            <div className="osk__row">
              {['https://', 'http://', '.com', '.net', '.org', ':443', '/dav'].map((snippet) => (
                <SnippetKey key={snippet} label={snippet} onSelect={() => setValue((v) => v + snippet)} />
              ))}
            </div>
          ) : null}

          <div className="osk__grid">
            {rows.flatMap((row, rowIndex) =>
              [...row].map((ch, colIndex) => (
                <Key
                  key={`${rowIndex}-${colIndex}`}
                  label={shift && !symbols ? ch.toUpperCase() : ch}
                  onSelect={() => append(ch)}
                  priority={rowIndex === 1 && colIndex === 0 ? 5 : 0}
                />
              )),
            )}
          </div>

          <div className="osk__row">
            <Key
              label={symbols ? 'abc' : shift ? '↑ ABC' : '↑ abc'}
              wide
              onSelect={() => (symbols ? setSymbols(false) : setShift((s) => !s))}
            />
            <Key label={symbols ? 'abc' : '#+='} wide onSelect={() => setSymbols((s) => !s)} />
            <Key label="space" wide onSelect={() => setValue((v) => v + ' ')} />
            <Key label="⌫ delete" wide onSelect={() => setValue((v) => v.slice(0, -1))} />
            <Key label="clear" wide onSelect={() => setValue('')} />
          </div>

          <div className="dialog__actions">
            <Button variant="primary" onSelect={() => onCommit(value)}>
              {t('field.done')}
            </Button>
            <Button variant="ghost" onSelect={onCancel}>
              {t('field.cancel')}
            </Button>
            {kind === 'password' ? (
              <Button variant="ghost" onSelect={() => setReveal((r) => !r)}>
                {reveal ? t('field.hide') : t('field.show')}
              </Button>
            ) : null}
            <span className="grow" />
            <span className="t-meta" style={{ alignSelf: 'center' }}>
              {input.phone.phoneCount > 0 ? t('field.tip.phone') : t('field.tip.pair')}
            </span>
          </div>
        </div>
      </FocusScope>
    </div>
  );
}

function Key({
  label,
  onSelect,
  wide,
  priority,
}: {
  label: string;
  onSelect: () => void;
  wide?: boolean;
  priority?: number;
}) {
  const f = useFocusable<HTMLButtonElement>({ onSelect, priority });
  return (
    <button
      ref={f.ref}
      className={cx('focusable osk__key', wide && 'osk__key--wide')}
      {...f.props}
    >
      {label}
    </button>
  );
}

function SnippetKey({ label, onSelect }: { label: string; onSelect: () => void }) {
  const f = useFocusable<HTMLButtonElement>({ onSelect });
  return (
    <button ref={f.ref} className="focusable osk__key osk__key--wide" {...f.props}>
      {label}
    </button>
  );
}

/* ======================================================================== *
 * Field
 *
 * Focusing a field also focuses a real <input>, so anyone with a physical
 * keyboard can just type. Pressing OK opens the on-screen keyboard, which is
 * the path for anyone holding only a remote. Both work; neither is bolted on.
 * ======================================================================== */

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  kind?: KeyboardKind;
  disabled?: boolean;
  priority?: number;
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  kind = 'text',
  disabled,
  priority,
}: FieldProps) {
  const t = useT();
  const [oskOpen, setOskOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  /**
   * Password managers autofill on page load, before anything is focused. Keeping
   * the input read-only until it is actually focused makes Chrome and Safari skip
   * it, and is the only part of this defence that works in every browser.
   */
  const [editable, setEditable] = useState(false);

  const f = useFocusable<HTMLDivElement>({
    disabled,
    priority,
    onSelect: () => setOskOpen(true),
    // Handing DOM focus to the inner input is what makes a physical keyboard
    // work without a second code path.
    onFocus: () => {
      setEditable(true);
      inputRef.current?.focus({ preventScroll: true });
    },
    onBlur: () => {
      inputRef.current?.blur();
      setEditable(false);
    },
  });

  const inputType = kind === 'password' ? 'password' : 'text';

  /**
   * Autofill suppression — a correctness fix, not a cosmetic one.
   *
   * These fields hold credentials for *someone else's server*, not a login for
   * this site. With `autocomplete="current-password"` the browser treated the
   * data-source password box as Hearth's own login box and filled in the
   * account password. Because autofill dispatches a real `input` event, that
   * value reached React state and would have been saved — silently replacing the
   * stored server password with the wrong secret.
   *
   * `new-password` is what tells a browser "never offer a saved credential
   * here". The non-semantic `name`, the vendor opt-outs and the read-only trick
   * cover the managers that ignore it.
   */
  const autoComplete = kind === 'password' ? 'new-password' : 'off';
  const fieldName = `hearth-${kind}-${fieldId.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <div className="field">
      <label className="t-label">{label}</label>
      <div ref={f.ref} className="focusable field__control" {...f.props}>
        <input
          ref={inputRef}
          type={inputType}
          value={value}
          placeholder={placeholder}
          name={fieldName}
          id={fieldName}
          autoComplete={autoComplete}
          // Read-only until focused, so page-load autofill skips it entirely.
          readOnly={!editable}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          disabled={disabled}
          // Vendor opt-outs: 1Password, LastPass, Bitwarden, Dashlane.
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setEditable(true)}
          // The engine owns navigation; a click should open the OSK, not
          // silently do nothing on a machine with no keyboard.
          onDoubleClick={() => setOskOpen(true)}
        />
        <span className="t-meta" aria-hidden="true">
          {kind === 'password' && value ? t('field.chars', { n: value.length }) : t('field.oksToType')}
        </span>
      </div>
      {error ? <p className="field__error">{error}</p> : null}
      {hint && !error ? <p className="field__hint">{hint}</p> : null}

      {oskOpen ? (
        <OnScreenKeyboard
          title={label}
          initial={value}
          kind={kind}
          placeholder={placeholder}
          onCommit={(next) => {
            onChange(next);
            setOskOpen(false);
          }}
          onCancel={() => setOskOpen(false)}
        />
      ) : null}
    </div>
  );
}
