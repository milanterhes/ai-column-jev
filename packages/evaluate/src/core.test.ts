import { describe, expect, it } from "vitest"
import {
  JUDGMENT_ID,
  SUFFICIENCY_ID,
  SUFFICIENCY_MIN,
  buildRequest,
  defaultThresholdFor,
  parseResponse,
  trimProviderResponse,
  type AiColumn,
  type JevResponse
} from "./core.ts"

const row = {
  ticket_id: "T-1",
  subject: "Bulk export",
  message: "We need to export all our reports as CSV in one go."
}

const yesNoColumn: AiColumn = {
  type: "yes_no",
  instruction: "Is this a feature request?",
  labels: [
    {
      name: "Yes",
      description: "Asks for a capability the product lacks",
      what: "The customer asks for a capability the product does not have",
      notFor: "A report of broken existing behaviour",
      examples: ["Please add a Slack integration", "Can you support SAML SSO?"]
    },
    {
      name: "No",
      description: "Does not ask for a new capability",
      what: "The message does not ask for a new capability",
      notFor: "A request for a capability that already exists"
    }
  ],
  needsReviewThreshold: 0.6
}

const categoryColumn: AiColumn = {
  type: "category",
  instruction: "What kind of message is this?",
  labels: [
    {
      name: "Bug",
      what: "Existing behaviour is broken",
      notFor: "A request for new behaviour",
      examples: ["Export times out"]
    },
    {
      name: "Feature",
      description: "Asks for a new capability",
      what: "The message requests a capability that does not exist"
    },
    { name: "Question", description: "Asks for an explanation rather than a change" },
    { name: "Other" }
  ],
  needsReviewThreshold: 0.8
}

const scoreColumn: AiColumn = {
  type: "score",
  instruction: "How urgent is this?",
  labels: [
    { name: "Low", what: "No time pressure", signals: ["No deadline mentioned"] },
    { name: "Medium", description: "Some time pressure" },
    { name: "High" }
  ],
  needsReviewThreshold: 0.8
}

describe("buildRequest", () => {
  it("sends the row as a structured object keyed by its fields", () => {
    const request = buildRequest(yesNoColumn, row)
    expect(request.state).toEqual({
      ticket_id: "T-1",
      subject: "Bulk export",
      message: "We need to export all our reports as CSV in one go."
    })
    expect(typeof request.state).toBe("object")
    expect(Array.isArray(request.state)).toBe(false)
  })

  it("renders null and undefined fields as empty strings", () => {
    const request = buildRequest(yesNoColumn, {
      ticket_id: "T-2",
      subject: null,
      message: undefined
    })
    expect(request.state).toEqual({ ticket_id: "T-2", subject: "", message: "" })
  })

  it("defaults the model and lets the caller override it", () => {
    expect(buildRequest(yesNoColumn, row).model).toBe("jev-latest")
    expect(buildRequest(yesNoColumn, row, "custom-model").model).toBe("custom-model")
  })

  it("builds a Noul question with true/false criteria objects for yes_no", () => {
    const question = buildRequest(yesNoColumn, row).questions[JUDGMENT_ID]
    expect(question).toEqual({
      type: "noul",
      instructions: {
        question: "Is this a feature request?",
        inspect: "`ticket_id`, `subject`, `message`"
      },
      criteria: {
        true: {
          what: "The customer asks for a capability the product does not have",
          not_for: "A report of broken existing behaviour",
          examples: ["Please add a Slack integration", "Can you support SAML SSO?"]
        },
        false: {
          what: "The message does not ask for a new capability",
          not_for: "A request for a capability that already exists"
        }
      }
    })
  })

  it("builds a Choice with criteria as a label to object map for category", () => {
    const question = buildRequest(categoryColumn, row).questions[JUDGMENT_ID]
    expect(question).toEqual({
      type: "choice",
      instructions: {
        question: "What kind of message is this?",
        inspect: "`ticket_id`, `subject`, `message`"
      },
      criteria: {
        Bug: {
          what: "Existing behaviour is broken",
          not_for: "A request for new behaviour",
          examples: ["Export times out"]
        },
        Feature: { what: "The message requests a capability that does not exist" },
        Question: { what: "Asks for an explanation rather than a change" },
        Other: { what: "Other" }
      }
    })
  })

  it("builds a Score with criteria as an ordered array of objects", () => {
    const question = buildRequest(scoreColumn, row).questions[JUDGMENT_ID]
    expect(question).toEqual({
      type: "score",
      instructions: {
        question: "How urgent is this?",
        inspect: "`ticket_id`, `subject`, `message`"
      },
      criteria: [
        { summary: "Low", what: "No time pressure", signals: ["No deadline mentioned"] },
        { summary: "Medium", what: "Some time pressure" },
        { summary: "High" }
      ]
    })
  })

  it("prefers what over description, then description, then name", () => {
    const question = buildRequest(categoryColumn, row).questions[JUDGMENT_ID]
    expect(question).toHaveProperty(
      "criteria.Feature.what",
      "The message requests a capability that does not exist"
    )
    expect(question).toHaveProperty(
      "criteria.Question.what",
      "Asks for an explanation rather than a change"
    )
    expect(question).toHaveProperty("criteria.Other.what", "Other")
  })

  it("includes a Noul sufficiency question whose false branch defines absence as a negative", () => {
    const question = buildRequest(yesNoColumn, row).questions[SUFFICIENCY_ID]
    expect(question).toEqual({
      type: "noul",
      instructions: {
        question: "Does the state contain what is needed to answer the question below?",
        question_under_test: "Is this a feature request?",
        note: "Judge whether the relevant content is present and specific enough. Do not judge the answer itself."
      },
      criteria: {
        true: {
          what: "The state contains the content the question needs — enough to give a definite answer, even if that answer is negative",
          examples: ["A specific description of what the customer wants or what is broken"]
        },
        false: {
          what: "The content the question needs is absent, empty, or too vague to judge",
          not_for:
            "A row that plainly contains no instance of the thing asked about is NOT missing information — that is a definite negative answer",
          examples: [
            "An empty message",
            "A single word such as 'help'",
            "Placeholder text with no substance"
          ]
        }
      }
    })
    expect(question).toHaveProperty(
      "criteria.false.not_for",
      expect.stringContaining("definite negative answer")
    )
  })

  it("names the inspected fields, and omits the hint for an empty row", () => {
    const withRow = buildRequest(yesNoColumn, { a: 1, b: 2 }).questions[JUDGMENT_ID]
    expect(withRow).toHaveProperty("instructions", {
      question: "Is this a feature request?",
      inspect: "`a`, `b`"
    })

    const empty = buildRequest(yesNoColumn, {}).questions[JUDGMENT_ID]
    expect(empty).toHaveProperty("instructions", {
      question: "Is this a feature request?"
    })
  })
})

describe("parseResponse — yes_no via Noul", () => {
  const respond = (noul: number, sufficiency = 0.9): JevResponse => ({
    answers: {
      [JUDGMENT_ID]: { type: "noul", noul },
      [SUFFICIENCY_ID]: { type: "noul", noul: sufficiency }
    }
  })

  it("selects the first label at or above 0.5 and the second below it", () => {
    const above = parseResponse(yesNoColumn, respond(0.8))
    expect(above.selectedValue).toBe("Yes")
    expect(above.confidence).toBe(0.8)
    expect(above.status).toBe("high_confidence")
    expect(above.distribution[0]).toEqual({ label: "Yes", probability: 0.8 })
    expect(above.distribution[1]?.label).toBe("No")
    expect(above.distribution[1]?.probability).toBeCloseTo(0.2, 10)

    const at = parseResponse(yesNoColumn, respond(0.5))
    expect(at.selectedValue).toBe("Yes")

    const below = parseResponse(yesNoColumn, respond(0.2))
    expect(below.selectedValue).toBe("No")
    expect(below.distribution[0]?.label).toBe("No")
  })

  it("uses the probability of the selected answer as confidence, in 0.5..1.0", () => {
    const yes = parseResponse(yesNoColumn, respond(0.8))
    const no = parseResponse(yesNoColumn, respond(0.2))
    expect(yes.confidence).not.toBeNull()
    expect(no.confidence).not.toBeNull()
    expect(yes.confidence).toBeGreaterThanOrEqual(0.5)
    expect(yes.confidence).toBeLessThanOrEqual(1)
    expect(no.confidence).toBeGreaterThanOrEqual(0.5)
    expect(no.confidence).toBeLessThanOrEqual(1)
    expect(yes.confidence).toBeCloseTo(0.8, 10)
    expect(no.confidence).toBeCloseTo(0.8, 10)
    const gap = Math.abs((yes.confidence ?? 0) - (no.confidence ?? 0))
    expect(gap).toBeLessThan(1e-10)
  })

  it("records sufficiency and keeps a null detail for a judged row", () => {
    const result = parseResponse(yesNoColumn, respond(0.8, 0.77))
    expect(result.sufficiency).toBe(0.77)
    expect(result.detail).toBeNull()
  })
})

describe("parseResponse — sufficiency gate", () => {
  const gated = (sufficiencyNoul: number | undefined): JevResponse => ({
    answers: {
      [JUDGMENT_ID]: { type: "noul", noul: 0.99, confidence: 0.93 },
      ...(sufficiencyNoul === undefined
        ? {}
        : { [SUFFICIENCY_ID]: { type: "noul", noul: sufficiencyNoul } })
    }
  })

  it("discards the judgment and reports unable_to_determine below SUFFICIENCY_MIN", () => {
    const result = parseResponse(yesNoColumn, gated(SUFFICIENCY_MIN - 0.01))
    expect(result.status).toBe("unable_to_determine")
    expect(result.selectedValue).toBeNull()
    expect(result.confidence).toBeNull()
    expect(result.distribution).toEqual([])
    expect(result.detail).toBeNull()
    expect(result.sufficiency).toBeCloseTo(SUFFICIENCY_MIN - 0.01, 10)
  })

  it("treats a missing sufficiency answer as unable_to_determine", () => {
    const result = parseResponse(yesNoColumn, gated(undefined))
    expect(result.status).toBe("unable_to_determine")
    expect(result.selectedValue).toBeNull()
    expect(result.distribution).toEqual([])
  })

  it("judges the row at exactly SUFFICIENCY_MIN", () => {
    const result = parseResponse(yesNoColumn, gated(SUFFICIENCY_MIN))
    expect(result.status).not.toBe("unable_to_determine")
    expect(result.selectedValue).toBe("Yes")
  })
})

describe("parseResponse — score", () => {
  it("maps index-keyed probabilities onto labels and keeps the fractional score", () => {
    const result = parseResponse(scoreColumn, {
      answers: {
        [JUDGMENT_ID]: {
          type: "score",
          probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
          score: 1.6,
          confidence: 0.72
        },
        [SUFFICIENCY_ID]: { type: "noul", noul: 0.95 }
      }
    })
    expect(result.selectedValue).toBe("High")
    expect(result.confidence).toBe(0.7)
    expect(result.providerConfidence).toBe(0.72)
    expect(result.distribution).toEqual([
      { label: "High", probability: 0.7 },
      { label: "Medium", probability: 0.2 },
      { label: "Low", probability: 0.1 }
    ])
    expect(result.detail).toEqual({ fractionalScore: 1.6 })
    expect(result.status).toBe("needs_review")
  })

  it("falls back to legend and then the raw index for unmapped positions", () => {
    const result = parseResponse(scoreColumn, {
      answers: {
        [JUDGMENT_ID]: {
          type: "score",
          probabilities: { "0": 0.6, "3": 0.4 },
          legend: { "3": "Unmapped level" }
        },
        [SUFFICIENCY_ID]: { type: "noul", noul: 0.95 }
      }
    })
    expect(result.distribution[0]).toEqual({ label: "Low", probability: 0.6 })
    expect(result.distribution[1]).toEqual({ label: "Unmapped level", probability: 0.4 })
    expect(result.selectedValue).toBe("Low")
  })

  it("leaves detail null when no fractional score is returned", () => {
    const result = parseResponse(scoreColumn, {
      answers: {
        [JUDGMENT_ID]: { type: "score", probabilities: { "2": 0.9 } },
        [SUFFICIENCY_ID]: { type: "noul", noul: 0.95 }
      }
    })
    expect(result.selectedValue).toBe("High")
    expect(result.confidence).toBe(0.9)
    expect(result.detail).toBeNull()
    expect(result.status).toBe("high_confidence")
  })
})

describe("parseResponse — category", () => {
  it("sorts the distribution by probability and takes the argmax", () => {
    const result = parseResponse(categoryColumn, {
      answers: {
        [JUDGMENT_ID]: {
          type: "choice",
          probabilities: { Bug: 0.2, Feature: 0.7, Question: 0.05, Other: 0.05 }
        },
        [SUFFICIENCY_ID]: { type: "noul", noul: 0.95 }
      }
    })
    expect(result.distribution).toEqual([
      { label: "Feature", probability: 0.7 },
      { label: "Bug", probability: 0.2 },
      { label: "Question", probability: 0.05 },
      { label: "Other", probability: 0.05 }
    ])
    expect(result.selectedValue).toBe("Feature")
    expect(result.confidence).toBe(0.7)
    expect(result.status).toBe("needs_review")
  })

  it("reports an empty distribution and zero confidence when no probabilities are given", () => {
    const result = parseResponse(categoryColumn, {
      answers: {
        [JUDGMENT_ID]: { type: "choice" },
        [SUFFICIENCY_ID]: { type: "noul", noul: 0.95 }
      }
    })
    expect(result.distribution).toEqual([])
    expect(result.selectedValue).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.status).toBe("needs_review")
  })
})

describe("parseResponse — threshold", () => {
  it("decides high_confidence vs needs_review from the column threshold", () => {
    const respond = (noul: number): JevResponse => ({
      answers: {
        [JUDGMENT_ID]: { type: "noul", noul },
        [SUFFICIENCY_ID]: { type: "noul", noul: 0.9 }
      }
    })
    expect(parseResponse(yesNoColumn, respond(0.6)).status).toBe("high_confidence")
    expect(parseResponse(yesNoColumn, respond(0.55)).status).toBe("needs_review")
  })

  it("accepts an explicit threshold that overrides the column", () => {
    const response: JevResponse = {
      answers: {
        [JUDGMENT_ID]: { type: "noul", noul: 0.9 },
        [SUFFICIENCY_ID]: { type: "noul", noul: 0.9 }
      }
    }
    expect(parseResponse(yesNoColumn, response, 0.95).status).toBe("needs_review")
    expect(parseResponse(yesNoColumn, response, 0.5).status).toBe("high_confidence")
  })

  it("carries token usage through to the result", () => {
    const result = parseResponse(yesNoColumn, {
      answers: {
        [JUDGMENT_ID]: { type: "noul", noul: 0.9 },
        [SUFFICIENCY_ID]: { type: "noul", noul: 0.9 }
      },
      usage: { input_tokens: 419, output_tokens: 37 }
    })
    expect(result.usage).toEqual({ inputTokens: 419, outputTokens: 37 })
  })
})

describe("trimProviderResponse", () => {
  it("keeps only answers and usage", () => {
    const response = {
      model: "jev-latest",
      answers: { [JUDGMENT_ID]: { type: "noul", noul: 0.8 } },
      usage: { input_tokens: 10, output_tokens: 5 },
      request_id: "should be dropped"
    }
    const trimmed = trimProviderResponse(response)
    expect(Object.keys(trimmed).sort()).toEqual(["answers", "usage"])
    expect(trimmed.answers).toEqual({ [JUDGMENT_ID]: { type: "noul", noul: 0.8 } })
    expect(trimmed.usage).toEqual({ input_tokens: 10, output_tokens: 5 })
  })

  it("defaults a missing answers subtree and usage", () => {
    const trimmed = trimProviderResponse({})
    expect(trimmed.answers).toEqual({})
    expect(trimmed.usage).toBeNull()
  })
})

describe("defaultThresholdFor", () => {
  it("returns 0.6 for yes_no and 0.8 otherwise", () => {
    expect(defaultThresholdFor("yes_no")).toBe(0.6)
    expect(defaultThresholdFor("category")).toBe(0.8)
    expect(defaultThresholdFor("score")).toBe(0.8)
  })
})
