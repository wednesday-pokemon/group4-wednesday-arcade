// Nickname (step 1 of 4): live + on-submit validation with sanitizeNickname (3–15 characters).
import { useId, useRef, useState, type ReactNode } from 'react';
import { NICKNAME, sanitizeNickname } from '../../game/index.ts';
import { useScreenFocus } from '../../app/keyboard.ts';
import { Button } from '../components/Button.tsx';
import { Icon } from '../Icon.tsx';

interface NicknameProps {
  initial: string;
  tools: ReactNode;
  onBack: () => void;
  onSubmit: (nickname: string) => void;
}

function friendlyError(raw: string): string | null {
  const result = sanitizeNickname(raw);
  if (result.ok) return null;
  const length = Array.from(raw.trim()).length;
  if (length > NICKNAME.maxLength) return `At most ${NICKNAME.maxLength} characters`;
  return `At least ${NICKNAME.minLength} characters`;
}

export function Nickname({ initial, tools, onBack, onSubmit }: NicknameProps) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const hintId = useId();
  const errorId = useId();
  useScreenFocus(h1, input);

  const error = friendlyError(value);
  const showError = error && (attempted || Array.from(value.trim()).length > NICKNAME.maxLength);

  const submit = () => {
    setAttempted(true);
    const result = sanitizeNickname(value);
    if (result.ok) onSubmit(result.value);
    else input.current?.focus();
  };

  return (
    <main className="screen screen--left scrim-left" data-testid="screen-nickname">
      <header className="topline">
        <span className="caps">Step 1 of 4</span>
        {tools}
      </header>
      <form
        className="left-col"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h1 ref={h1} tabIndex={-1} className="display screen-title">What should the board call you?</h1>
        <div className="nickname-field">
          <input
            ref={input}
            className="input"
            value={value}
            maxLength={NICKNAME.maxLength + 5}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Nickname"
            aria-invalid={showError ? true : undefined}
            aria-describedby={`${hintId}${showError ? ` ${errorId}` : ''}`}
            autoComplete="off"
            spellCheck={false}
            data-testid="input-nickname"
          />
          <span className="nickname-field__count num" aria-hidden="true">
            {Array.from(value.trim()).length}/{NICKNAME.maxLength}
          </span>
        </div>
        <p id={hintId} className="text-2 hint">3–15 letters, numbers or spaces</p>
        <p id={errorId} className="field-error" aria-live="polite">
          {showError && (
            <>
              <Icon name="alert" />
              {error}
            </>
          )}
        </p>
        <div className="button-row">
          <Button variant="primary" size="lg" kbd="Enter" type="submit" data-testid="btn-continue">Continue</Button>
          <Button variant="ghost" onClick={onBack} data-testid="btn-back">Back</Button>
        </div>
      </form>
    </main>
  );
}
