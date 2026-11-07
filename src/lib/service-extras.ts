export type ServiceExtras = {
  service_type_id: string | null;
  service_type_label: string | null;
};

export function readServiceExtras(formData: FormData): ServiceExtras {
  const id = String(formData.get("service_type_id") ?? "").trim();
  const label = String(formData.get("service_type_label") ?? "").trim();
  return {
    service_type_id: id.length > 0 ? id : null,
    service_type_label: label.length > 0 ? label : null,
  };
}
