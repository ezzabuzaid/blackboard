export interface GroupAgent {
  id: string
  name: string
  responsibility: string
}

export interface GroupTemplate {
  id: string
  name: string
  category: string
  outcome: string
  agents: readonly GroupAgent[]
  scratch?: boolean
}

export const groupTemplates: readonly GroupTemplate[] = [
  {
    id: "customer-discovery",
    name: "Customer Discovery",
    category: "Research",
    outcome:
      "Turn a guessed customer problem into an evidence-backed market position.",
    agents: [
      {
        id: "rob-fitzpatrick",
        name: "Rob Fitzpatrick",
        responsibility: "Keeps interviews grounded in real past behavior.",
      },
      {
        id: "april-dunford",
        name: "April Dunford",
        responsibility: "Turns customer evidence into sharp positioning.",
      },
      {
        id: "elena-verna",
        name: "Elena Verna",
        responsibility: "Tests activation, retention, and growth signals.",
      },
      {
        id: "andrew-chen",
        name: "Andrew Chen",
        responsibility: "Evaluates acquisition loops and network effects.",
      },
    ],
  },
  {
    id: "market-intelligence",
    name: "Market Intelligence",
    category: "Strategy",
    outcome:
      "Turn noisy market signals into one defensible strategic decision.",
    agents: [
      {
        id: "richard-rumelt",
        name: "Richard Rumelt",
        responsibility: "Finds the pivotal challenge and coherent action.",
      },
      {
        id: "hamilton-helmer",
        name: "Hamilton Helmer",
        responsibility: "Tests whether the advantage can become durable power.",
      },
      {
        id: "charlie-munger",
        name: "Charlie Munger",
        responsibility: "Applies multidisciplinary models and inversion.",
      },
      {
        id: "julia-galef",
        name: "Julia Galef",
        responsibility: "Challenges motivated reasoning and weak evidence.",
      },
    ],
  },
  {
    id: "company-building",
    name: "Company Building",
    category: "Operations",
    outcome:
      "Shape the operating system, team, and product around what matters.",
    agents: [
      {
        id: "andy-grove",
        name: "Andy Grove",
        responsibility: "Raises managerial leverage and operating discipline.",
      },
      {
        id: "jeff-bezos",
        name: "Jeff Bezos",
        responsibility: "Works backward from customers through mechanisms.",
      },
      {
        id: "brian-chesky",
        name: "Brian Chesky",
        responsibility: "Protects quality, craft, and founder-level detail.",
      },
      {
        id: "matt-mochary",
        name: "Matt Mochary",
        responsibility:
          "Clarifies ownership, decisions, and hard conversations.",
      },
    ],
  },
  {
    id: "content-studio",
    name: "Content Studio",
    category: "Content",
    outcome: "Develop one clear idea into persuasive, publish-ready material.",
    agents: [
      {
        id: "william-zinsser",
        name: "William Zinsser",
        responsibility: "Removes clutter and protects the human voice.",
      },
      {
        id: "david-ogilvy",
        name: "David Ogilvy",
        responsibility:
          "Makes the promise specific, researched, and persuasive.",
      },
      {
        id: "harry-dry",
        name: "Harry Dry",
        responsibility: "Turns abstractions into concrete, memorable copy.",
      },
      {
        id: "wes-kao",
        name: "Wes Kao",
        responsibility:
          "Sharpens hierarchy, credibility, and executive clarity.",
      },
    ],
  },
  {
    id: "capital-strategy",
    name: "Capital Strategy",
    category: "Finance",
    outcome:
      "Stress-test fundraising, leverage, and long-term capital choices.",
    agents: [
      {
        id: "paul-graham",
        name: "Paul Graham",
        responsibility:
          "Keeps the company alive and focused on what users want.",
      },
      {
        id: "peter-thiel",
        name: "Peter Thiel",
        responsibility: "Tests contrarian insight, monopoly, and market entry.",
      },
      {
        id: "naval-ravikant",
        name: "Naval Ravikant",
        responsibility:
          "Examines leverage, judgment, and compounding incentives.",
      },
      {
        id: "marc-andreessen",
        name: "Marc Andreessen",
        responsibility:
          "Frames venture scale, markets, and strategic financing.",
      },
      {
        id: "tambi-jalouqa",
        name: "Tambi Jalouqa",
        responsibility:
          "Tests technical founders, product judgment, and global ambition from MENA.",
      },
    ],
  },
  {
    id: "scratch",
    name: "Build from scratch",
    category: "Custom",
    outcome:
      "Start with Factory and describe the group you need in plain language.",
    scratch: true,
    agents: [
      {
        id: "factory",
        name: "Factory",
        responsibility: "Creates the agents and responsibilities you ask for.",
      },
    ],
  },
]
