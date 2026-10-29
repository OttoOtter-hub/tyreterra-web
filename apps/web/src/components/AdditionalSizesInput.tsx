'use client';
import TireSizeInput from './TireSizeInput';

/** Same limit as the API (MAX_ADDITIONAL_SIZES) */
const MAX_ADDITIONAL = 3;

interface Props {
  value: string[];
  onChange: (value: string[]) => void;
}

// Further sizes of the same tyre (e.g. 440/80-28 for a 16.9-28). Each one is
// parsed like the main size; the listing is found by any of them.
export default function AdditionalSizesInput({ value, onChange }: Props) {
  const set = (i: number, v: string) => onChange(value.map((s, j) => (j === i ? v : s)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  return (
    <div className="additional-sizes">
      {value.map((s, i) => (
        <div key={i} className="additional-size-row">
          <div className="additional-size-input">
            <TireSizeInput value={s} onChange={(v) => set(i, v)} />
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-label={`Remove additional size ${i + 1}`}
            onClick={() => remove(i)}
          >
            Remove
          </button>
        </div>
      ))}
      {value.length < MAX_ADDITIONAL && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...value, ''])}>
          + Add another size
        </button>
      )}
    </div>
  );
}
