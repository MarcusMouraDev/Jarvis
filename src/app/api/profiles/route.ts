import { getProfile, listProfiles } from "@/core/profiles";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const profile = getProfile(id);
    if (!profile) {
      return new Response(JSON.stringify({ error: "profile_not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return Response.json({ profile });
  }

  return Response.json({ profiles: listProfiles() });
}
