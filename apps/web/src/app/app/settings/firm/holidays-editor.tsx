"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/forms/use-action";
import { setHolidaysAction } from "@/server/actions/master";
import { formatDate } from "@/lib/utils";

type H = { date: string; name: string };

export function HolidaysEditor({ initial }: { initial: H[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<H[]>(initial);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  const { pending, error, setError, submit } = useAction(setHolidaysAction);
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);

  return (
    <div className="grid gap-4">
      <ul className="grid gap-1 text-sm" data-testid="holidays">
        {rows.length === 0 && <li className="text-muted-foreground">No holidays.</li>}
        {rows.map((h) => (
          <li key={h.date} className="flex items-center gap-3">
            <span className="w-32 tabular-nums">{formatDate(h.date)}</span>
            <span className="flex-1">{h.name}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows(rows.filter((r) => r.date !== h.date))}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input type="date" aria-label="Holiday date" value={date} onChange={(e) => setDate(e.target.value)} className="sm:w-44" />
        <Input aria-label="Holiday name" placeholder="Thanksgiving" value={name} onChange={(e) => setName(e.target.value)} />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (!date || !name.trim()) return setError("Enter a date and a name");
            if (rows.some((r) => r.date === date)) return setError("That date is already in the calendar");
            setError(null);
            setSaved(false);
            setRows([...rows, { date, name: name.trim() }].sort((a, b) => a.date.localeCompare(b.date)));
            setDate("");
            setName("");
          }}
        >
          Add
        </Button>
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {saved && !dirty && <Alert variant="success">Holiday calendar saved.</Alert>}
      <div>
        <Button
          type="button"
          disabled={pending || !dirty}
          onClick={() =>
            submit({ holidays: rows }, () => {
              setSaved(true);
              router.refresh();
            })
          }
        >
          Save holidays
        </Button>
      </div>
    </div>
  );
}
