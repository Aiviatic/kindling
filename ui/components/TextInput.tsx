import { useId, type InputHTMLAttributes } from 'react';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Always-visible label (DESIGN.md: placeholder is never the label). */
  label: string;
}

// Bold Spark text input with an always-visible, programmatically-associated label.
// (EXPERIENCE.md a11y floor: the label is real text tied to the input via htmlFor/id,
// not a placeholder — placeholders use the RESTRICTED text-muted tone.)
export function TextInput({ label, id, className, ...rest }: TextInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="field">
      <label className="field-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className={['field-input', className].filter(Boolean).join(' ')}
        {...rest}
      />
    </div>
  );
}
