import { NextResponse } from "next/server";
import { indicesMercado } from "@/lib/cotacao";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await indicesMercado());
}
