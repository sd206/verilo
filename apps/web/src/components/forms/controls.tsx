import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Labelled inputs for master-data forms. Names match the server action input keys. */
export function TextField({
  label,
  name,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function MoneyField({ label, name, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span>
        <Input id={name} name={name} inputMode="decimal" className="pl-6 text-right tabular-nums" placeholder="0.00" {...props} />
      </div>
    </div>
  );
}

export function SelectField({
  label,
  name,
  options,
  placeholder,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Select id={name} name={name} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function TextAreaField({ label, name, hint, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; name: string; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Textarea id={name} name={name} {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function CheckboxField({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 rounded border-input accent-[var(--color-primary)]" />
      {label}
    </label>
  );
}

export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-4">
      <legend className="mb-1 text-sm font-semibold">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
