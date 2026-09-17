/**
 * Live verification of the evaluation core against the real Jev API.
 *
 * Run with:  set -a && . ./.env && set +a && node packages/evaluate/src/verify.ts
 *
 * This is a diagnostic, not part of the app. It exists so the request/response
 * contract can be proven against the provider rather than assumed.
 */
import { buildRequest, parseResponse, type AiColumn } from "./core.ts"

const key = process.env["JEV_KEY"]
if (key === undefined || key === "") {
  console.error("JEV_KEY is not set")
  process.exit(1)
}

const call = async (body: unknown) => {
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  })
  const json = await response.json()
  return { status: response.status, json: json as Record<string, unknown> }
}

const row = {
  company: "Acme",
  description: "Acme builds HR software for enterprise companies, sold as a subscription.",
  employee_count: "420",
  country: "United States"
}

const ambiguous = {
  company: "Vectora",
  description: "We make stuff for businesses.",
  employee_count: "",
  country: "Germany"
}

const borderline = [
  {
    company: "PixelPop",
    description: "PixelPop makes photo filters for consumers. It also licenses its filter engine to a handful of enterprise apps.",
    employee_count: "40",
    country: "United States"
  },
  {
    company: "Northwind Consulting",
    description: "Northwind is a consulting firm that builds custom internal tools for clients, sometimes hosted.",
    employee_count: "120",
    country: "Canada"
  },
  {
    company: "Graze",
    description: "Graze is a marketplace connecting freelancers with studios.",
    employee_count: "15",
    country: "United Kingdom"
  }
]

const columns: ReadonlyArray<AiColumn> = [
  {
    type: "yes_no",
    instruction: "Is this company primarily a B2B SaaS company?",
    labels: [
      { name: "Yes", description: "Primarily sells software as a service to businesses." },
      { name: "No", description: "Does not primarily sell B2B SaaS." }
    ],
    needsReviewThreshold: 0.8
  },
  {
    type: "category",
    instruction: "Which category best describes this company?",
    labels: [
      { name: "B2B SaaS", description: "Subscription software sold to businesses." },
      { name: "Consumer", description: "Products for individual consumers." },
      { name: "Agency", description: "Services delivered for clients." },
      { name: "Marketplace", description: "Two-sided platform connecting buyers and sellers." },
      { name: "Other", description: "None of the above." }
    ],
    needsReviewThreshold: 0.8
  },
  {
    type: "score",
    instruction: "How strong a fit is this company for an enterprise HR-tech ICP?",
    labels: [
      { name: "Excellent fit" },
      { name: "Good fit" },
      { name: "Weak fit" },
      { name: "Poor fit" }
    ],
    needsReviewThreshold: 0.8
  }
]

for (const column of columns) {
  for (const [name, data] of [
    ["clear", row],
    ["ambiguous", ambiguous],
    ...borderline.map((r, i) => [`border${i + 1}`, r] as const)
  ] as const) {
    const request = buildRequest(column, data)
    const { status, json } = await call(request)
    if (status !== 200) {
      console.log(`✗ ${column.type} / ${name} -> HTTP ${status}`)
      console.log(JSON.stringify(json).slice(0, 400))
      continue
    }
    const result = parseResponse(column, json)
    console.log(
      `✓ ${column.type.padEnd(9)} ${name.padEnd(10)} -> ${result.status.padEnd(19)}` +
        ` value=${String(result.selectedValue).padEnd(13)}` +
        ` confidence=${String(result.confidence).padEnd(6)}` +
        ` distribution=[${result.distribution.map((d) => `${d.label}:${d.probability}`).join(", ")}]` +
        (result.detail === null ? "" : ` score=${result.detail.fractionalScore}`)
    )
  }
}
