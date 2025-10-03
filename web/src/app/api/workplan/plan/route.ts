import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { OpenAIAgent, runOpenAIAgent } from "@/lib/openai";
import { MODELS } from "@/lib/utils";

const eventSchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string().optional(),
  end: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
});

const bodySchema = z.object({
  event: z.object({
    id: z.string(),
    title: z.string(),
    start: z.string().optional(),
    end: z.string().optional(),
    location: z.string().optional(),
    description: z.string().optional(),
  }),
  userRole: z.string().optional(), // Highest-priority role string (e.g., "volunteer lead")
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 422 });
  }

  const evt = parsed.data.event;
  const userRole = (parsed.data.userRole?.trim() || "attendee").toLowerCase();

  const when = [evt.start, evt.end].filter(Boolean).join(" - ");
  const meta: string[] = [];
  if (when) meta.push(`When: ${when}`);
  if (evt.location) meta.push(`Location: ${evt.location}`);
  if (evt.description) meta.push(`Notes: ${evt.description}`);

  const instructions =
    "You are Micromanager, an operations assistant. Produce a concise, practical, step-by-step work plan tailored to the user's role in this event. Keep each step short and actionable. Output only the steps as a numbered list.";

  const roleLine = `User role for this event: ${userRole}. Prioritize tasks relevant to this role.`;

  const prompt = [
    `Event: ${evt.title}`,
    ...meta,
    roleLine,
    "",
    "Return 6-10 steps, numbered, one per line.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const agent = new OpenAIAgent({
      name: "workplan",
      instructions,
      model: MODELS.text,
      tools: [],
    });

    const result = await runOpenAIAgent(agent, prompt);
    const text = result.finalOutput?.trim() ?? "";

    const steps = splitToSteps(text);
    return NextResponse.json({ steps });
  } catch (error) {
    console.error("[WorkPlan API] Error:", error);
    return NextResponse.json({ error: "Failed to generate plan" }, { status: 500 });
  }
}

function splitToSteps(text: string): string[] {
  if (!text) return [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const cleaned = lines.map((l) => l.replace(/^\d+[\.\)]\s*/, "").trim());
  return cleaned.slice(0, 12);
}
