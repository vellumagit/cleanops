"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { FormSelect } from "@/components/form-field";
import { Label } from "@/components/ui/label";

type Option = { id: string; label: string };

export function ReviewsFilters({
  employees,
  employee,
  minRating,
}: {
  employees: Option[];
  employee: string;
  minRating: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: "employee" | "min_rating", value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "") next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `/app/reviews?${qs}` : "/app/reviews");
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1.5">
        <Label htmlFor="filter-employee">Employee</Label>
        <FormSelect
          id="filter-employee"
          className="w-56"
          value={employee}
          disabled={pending}
          onChange={(e) => update("employee", e.target.value)}
        >
          <option value="">All employees</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </FormSelect>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filter-min-rating">Min rating</Label>
        <FormSelect
          id="filter-min-rating"
          className="w-40"
          value={minRating}
          disabled={pending}
          onChange={(e) => update("min_rating", e.target.value)}
        >
          <option value="">Any</option>
          <option value="5">5 stars</option>
          <option value="4">4+ stars</option>
          <option value="3">3+ stars</option>
          <option value="2">2+ stars</option>
        </FormSelect>
      </div>
    </div>
  );
}
