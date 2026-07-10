"use server";

import { redirect } from "next/navigation";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { acknowledgeAlert, resolveAlert, acknowledgeAllAlerts } from "../../../server/online-monitoring/alerts";

// ── Alert actions ─────────────────────────────────────────────────────

export async function acknowledgeAlertAction(formData: FormData) {
  const alertId = formData.get("alertId");

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    redirect("/app?onlineError=noCompany");
  }

  if (typeof alertId !== "string") {
    redirect("/app/online-monitoring/alerts?error=missingAlertId");
  }

  const companyId = membershipResult.membership.companyId;
  await acknowledgeAlert(alertId, companyId);

  redirect("/app/online-monitoring/alerts");
}

export async function resolveAlertAction(formData: FormData) {
  const alertId = formData.get("alertId");

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    redirect("/app?onlineError=noCompany");
  }

  if (typeof alertId !== "string") {
    redirect("/app/online-monitoring/alerts?error=missingAlertId");
  }

  const companyId = membershipResult.membership.companyId;
  await resolveAlert(alertId, companyId);

  redirect("/app/online-monitoring/alerts?resolved=1");
}

export async function acknowledgeAllAlertsAction(formData: FormData) {
  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    redirect("/app?onlineError=noCompany");
  }

  const companyId = membershipResult.membership.companyId;
  await acknowledgeAllAlerts(companyId);

  redirect("/app/online-monitoring/alerts?ackAll=1");
}

// ── Source actions ─────────────────────────────────────────────────────

export async function runSourceAction(formData: FormData) {
  const sourceKey = formData.get("sourceKey");
  const storeId = formData.get("storeId");

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    redirect("/app?onlineError=noCompany");
  }

  if (typeof sourceKey !== "string" || !sourceKey) {
    redirect("/app/online-monitoring?error=missingSource");
  }

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();

  const { data: source } = await supabase
    .from("online_sources")
    .select("id, source_key")
    .eq("company_id", companyId)
    .eq("source_key", sourceKey)
    .single();

  if (!source) {
    redirect("/app/online-monitoring?error=sourceNotFound");
  }

  const sourceStoreId = typeof storeId === "string" && storeId !== "" ? storeId : null;

  const { data: run, error } = await supabase
    .from("online_source_runs")
    .insert({
      company_id: companyId,
      source_id: source.id,
      source_store_id: sourceStoreId,
      trigger: "manual",
      status: "queued",
      parser_version: "1.0.0",
      stats: { fetched: 0, productsUpserted: 0, pricesInserted: 0, matched: 0, unmatched: 0, errors: 0 },
    })
    .select("id")
    .single();

  if (error || !run) {
    redirect("/app/online-monitoring?error=runFailed");
  }

  redirect("/app/online-monitoring/runs");
}

export async function confirmMatchAction(formData: FormData) {
  const matchId = formData.get("matchId");
  const catalogProductId = formData.get("catalogProductId");

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    redirect("/app?onlineError=noCompany");
  }

  if (typeof matchId !== "string" || typeof catalogProductId !== "string") {
    redirect("/app/online-monitoring/unmatched?error=missingParams");
  }

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("online_product_matches")
    .update({
      status: "confirmed",
      catalog_product_id: catalogProductId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", matchId)
    .eq("company_id", companyId);

  if (error) {
    redirect("/app/online-monitoring/unmatched?error=confirmFailed");
  }

  redirect("/app/online-monitoring/unmatched?confirmed=1");
}

export async function rejectMatchAction(formData: FormData) {
  const matchId = formData.get("matchId");

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    redirect("/app?onlineError=noCompany");
  }

  if (typeof matchId !== "string") {
    redirect("/app/online-monitoring/unmatched?error=missingMatchId");
  }

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("online_product_matches")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", matchId)
    .eq("company_id", companyId);

  if (error) {
    redirect("/app/online-monitoring/unmatched?error=rejectFailed");
  }

  redirect("/app/online-monitoring/unmatched?rejected=1");
}
