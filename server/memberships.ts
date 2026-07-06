import { createSupabaseServerClient } from "../lib/supabase/server";

export type CompanyMembership = {
  companyId: string;
  companyName: string;
  role: "admin" | "manager" | "reviewer";
};

type CompanyMembershipRow = {
  company_id: string;
  role: CompanyMembership["role"];
  companies: {
    name: string;
  } | null;
};

export async function getCurrentUserCompanyMemberships(): Promise<CompanyMembership[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("company_members")
    .select("company_id, role, companies(name)")
    .order("created_at", { ascending: true })
    .returns<CompanyMembershipRow[]>();

  if (error) {
    throw new Error(`Не удалось получить доступы к компаниям: ${error.message}`);
  }

  return data.map((membership) => ({
    companyId: membership.company_id,
    companyName: membership.companies?.name ?? "Компания без названия",
    role: membership.role,
  }));
}
