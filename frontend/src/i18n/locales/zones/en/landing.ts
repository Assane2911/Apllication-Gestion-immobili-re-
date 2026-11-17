import type { ZoneLanding } from "../fr/landing";

/** Textes de la page d'accueil publique, chargés avec elle. */
const zone: ZoneLanding = {
  landing: {
      reminders: {
        title: "Simulator · Automatic reminders",
        subtitle: "Set the delay and the interval, as in your agency settings.",
        grace: "Delay before the first reminder",
        interval: "Interval between two reminders",
        days_one: "{{count}} day",
        days_other: "{{count}} days",
        day: "D+{{day}}",
        timeline: "Reminder schedule for an unpaid rent",
        steps: { due: "Rent due date", first: "Friendly reminder", second: "Second reminder", third: "Final reminder", end: "End of automatic reminders: the rest is up to you" },
        summary: "Friendly reminder at D+{{first}}, second reminder at D+{{second}}, final reminder at D+{{third}}.",
        note: "Each reminder goes out by email to the tenant and co-tenants; WhatsApp with the Professional plan. You can also notify guarantors.",
        cta: "Turn on reminders during the trial",
      },
    stickyCta: "Try it for free",
    steps: {
      title: "From sign-up to your first receipt",
      create: { title: "Create your account", desc: "A few minutes is enough: an email address, your agency's country, and the 15-day trial starts." },
      add: { title: "Add your properties and tenants", desc: "Enter your properties, tenants and leases, or import them from a file." },
      automate: { title: "Let the platform work", desc: "Receipts, rent reminders and profitability tracking happen without re-typing." },
    },
    nav: {
      features: "Features",
      vitrine: "Our properties",
      receipts: "Receipts & Signature",
      compare: "Comparison",
      pricing: "Pricing",
      currencies: "Multi-Currency",
      security: "Security",
      faq: "FAQ",
      goToSpace: "Go to my dashboard →",
      login: "Sign in",
      trial: "Free 15-day trial →",
      trialShort: "Free trial →",
      top: "Back to top",
      menu: "Menu",
    },
    badge: "New Version 2.0 • 15-day free trial, no commitment",
    hero: {
      titleLine1: "Rental property management,",
      titleLine2: "reinvented & automated.",
      subtitle:
        "Generate PDF rent receipts, get your leases signed online, send automatic reminders on the 1st of each month, and track your net profitability in real time.",
      ctaTrial: "Start your free 15-day trial →",
      ctaPricing: "See pricing",
    },
    features: {
      receipts: {
        title: "PDF Receipts & Leases",
        desc: "Instant download of rent receipts with the agency's stamp, serial number and legal notices as soon as payment is confirmed.",
      },
      signature: {
        title: "Touch Electronic Signature",
        desc: "Get your lease agreements signed directly on a smartphone or tablet. Secure timestamping and digital archiving.",
      },
      reminders: {
        title: "Automatic Alerts on the 1st of the Month",
        desc: "Reminders scheduled on the 1st of each month, noting each tenant's own rent deadline, with a secure payment link.",
      },
      dashboard: {
        title: "Real-Time Dashboard & Statistics",
        desc: "See your occupancy rate, collected revenue, unpaid invoices and property status at a glance, with clear, live-updated charts.",
      },
      expenses: {
        title: "Expense Tracking & Net Profitability",
        desc: "Log your maintenance costs, taxes and charges, and automatically see your real cash flow — revenue minus expenses — month after month.",
      },
      tenantPortal: {
        title: "Dedicated Tenant Portal",
        desc: "Your tenants pay their rent, view their receipts, report an issue with a photo, and message you directly — no phone calls, no paperwork.",
      },
      security: {
        title: "Security & GDPR Compliance",
        desc: "Strict data isolation between agencies, encrypted passwords, secure connections and hosting in France — built with GDPR in mind from day one.",
      },
      multiCurrency: {
        title: "Multi-Currency",
        desc: "Display and collect rent in the currency of your choice, matched to your market and your tenants'.",
      },
      multiLanguage: {
        title: "Multilingual Interface",
        desc: "French, English, Portuguese and Spanish: every user picks their display language in one click, with no setup required.",
      },
    },
    featuresSection: {
      title: "Everything you need to manage your rentals with peace of mind",
      subtitle: "One single platform, from lease to payment collection, for independent landlords and agencies alike.",
    },
    extras: [
      "Built-in messaging",
      "Instant global search",
      "Full activity log",
      "CSV accounting export",
      "White label for your agency",
    ],
    productTour: {
      title: "See the platform in action",
      subtitle: "An interface built for speed, for you and for your tenants alike.",
      dashboard: {
        title: "A clear, actionable dashboard",
        desc: "Revenue, occupancy, unpaid invoices and issues: all of today's priorities, brought together on a single screen.",
      },
      contracts: {
        title: "Leases signed in a few clicks",
        desc: "Contract generation, touch signature from the tenant, automatic archiving — no printer, no scanner.",
      },
      expenses: {
        title: "Profitability that's always up to date",
        desc: "Every expense you log instantly recalculates your net cash flow, property by property.",
      },
      tenant: {
        title: "A smooth tenant experience",
        desc: "Receipts, documents to sign and direct messaging: your tenants no longer need to call you for every little thing.",
      },
    },
    forWho: {
      title: "Built for every kind of rental management",
      subtitle: "Whether you manage a single studio or several hundred units, there's a plan for you.",
      independent: {
        title: "Independent landlord",
        desc: "Manage your few properties with ease: automatic receipts, payment reminders and a tenant portal, without unnecessary complexity.",
      },
      agency: {
        title: "Real estate agency",
        desc: "Electronic signature, profitability tracking and white labeling to present a professional image to your landlord and tenant clients.",
      },
      enterprise: {
        title: "Large portfolio manager",
        desc: "Multiple users, automated accounting export and priority support to run hundreds of properties without losing visibility.",
      },
    },
    trust: {
      title: "Your data, seriously protected",
      subtitle: "Security isn't an afterthought — it's part of the service's architecture.",
      items: [
        "Data hosted in France (Paris), on dedicated infrastructure.",
        "Strict data isolation between agencies: no manager can see another agency's properties, tenants or payments.",
        "Encrypted passwords and fully secured HTTPS connections.",
        "A GDPR-compliant privacy policy, available to read at any time.",
      ],
      linkLabel: "Read our privacy policy →",
    },
    faq: {
      searchLabel: "Search the FAQ",
      searchPlaceholder: "Search a question…",
      noResult: "No question matches your search.",
      clearSearch: "Clear the search",
      title: "Frequently asked questions",
      items: [
        {
          q: "How long does it take to get started?",
          a: "Just a few minutes: create your account, add your first property and immediately enjoy a 15-day free trial, no credit card required.",
        },
        {
          q: "Is my data secure?",
          a: "Yes: your data is hosted in France, encrypted and strictly isolated from other agencies using the platform. See our privacy policy for details.",
        },
        {
          q: "What payment methods can my tenants use?",
          a: "A bank transfer to your agency's account: the tenant declares it in the app, then you mark the invoice as paid once the money arrives. Paying rent by card or Mobile Money is not offered for now.",
        },
        {
          q: "Can I cancel my subscription at any time?",
          a: "Yes, with no commitment. You can cancel from your manager dashboard at any time; access remains active until the end of the period already paid for.",
        },
        {
          q: "Does the service work outside of France?",
          a: "Yes: a customizable display currency, a 4-language interface, and payment methods suited to both French-speaking Africa and international use.",
        },
      ],
    },
    finalCta: {
      title: "Ready to modernize your rental management?",
      subtitle: "Join the managers who've already simplified their receipts, reminders and financial tracking.",
      cta: "Start my free 15-day trial →",
    },
    pricing: {
      perYear: "/ year",
      monthlyEquivalent: "i.e. {{price}} / month",
      currencyLabel: "Currency",
      cycleLabel: "Billing period",
      monthly: "Monthly",
      annual: "Annual",
      annualSaving: "Pay yearly: {{pct}}% saved",
      advisor: {
        title: "Find my plan",
        label: "How many properties do you manage?",
        result_one: "For {{count}} property, we recommend",
        result_other: "For {{count}} properties, we recommend",
        upTo: "Up to {{max}} properties included",
        unlimited: "Unlimited properties",
        perProperty: "i.e. {{price}} per property per month",
        forYou_one: "For your {{count}} property",
        forYou_other: "For your {{count}} properties",
      },
      title: "Simple, transparent plans",
      subtitle: "Every plan includes a free 15-day trial, no credit card required, with a step-by-step getting started guide.",
      perMonth: "/ month",
      starter: {
        name: "Starter",
        cta: "Start the 15-day trial",
      },
      pro: {
        name: "Professional",
        badge: "Recommended",
        cta: "Start the free 15-day trial",
      },
      enterprise: {
        name: "Agency & Multi-Accounts",
        cta: "Start the 15-day trial",
      },
    },
    compare: {
      badge: "Comparison & Added Value",
      titlePrefix: "Traditional management vs",
      subtitle:
        "Find out why modern agencies and landlords are leaving Excel spreadsheets, scattered WhatsApp conversations and paperwork behind for 100% automated rental management.",
      roi: {
        adminTime: "Admin time",
        unpaidRent: "Forgotten unpaid rent",
        certified: "Automated leases & receipts",
      },
      headers: {
        feature: "Feature & process",
        traditional: "Traditional management (Excel / paper)",
        recommended: "Recommended",
      },
      rows: {
        reminders: {
          title: "Rent notices & reminders",
          description: "Anticipate payments and reduce unpaid rent",
          traditional: "Frequent oversights, awkward phone calls, scattered WhatsApp messages, regular late payments.",
          immoplatform: "Automatic rent notice on the 1st of every month, with a reminder before the due date set in the lease. Instant invoices with live status.",
        },
        receipts: {
          title: "Automatic rent receipts",
          description: "Legal generation and delivery to tenants",
          traditional: "Manual creation in Word/Excel, tedious PDF conversion, emails often forgotten.",
          immoplatform: "Automatic one-click generation as a PDF with agency stamp, unique number and legal notices.",
        },
        signature: {
          title: "Lease signing",
          description: "Legal validation and conclusion of leases",
          traditional: "Paper printing, initialling page by page, mandatory trips in person, lost leases.",
          immoplatform: "Electronic touch signature (computer, tablet, mobile) with a timestamp in 2 minutes.",
        },
        incidents: {
          title: "Breakdown & incident reports",
          description: "Repair and maintenance follow-up",
          traditional: "Emergency phone calls, vague descriptions, undated photos, no history.",
          immoplatform: "Photo taken directly by the tenant, high-resolution gallery for the agency and real-time follow-up of the intervention.",
        },
        expenses: {
          title: "Expense tracking & net cash flow",
          description: "Real profitability calculation and accounting",
          traditional: "Scattered contractor invoices, manual year-end calculations, no visibility on net yield.",
          immoplatform: "Expenses recorded by category, automatic net cash-flow calculation and one-click CSV accounting export.",
        },
        branding: {
          title: "Branding & multi-currency",
          description: "Professionalism and international reach",
          traditional: "Plain or unprofessional documents, manual conversion prone to exchange errors.",
          immoplatform: "White-label agency (logo, legal identifiers, letterhead) and support for the euro and the CFA franc (FCFA).",
        },
      },
      cta: {
        text: "Ready to modernise the management of your property portfolio today?",
        button: "Start your 15-day free trial →",
      },
    },
    mock: {
      netFlow: "Net flow",
      rentMonth: "September rent",
      pay: "Pay",
      tenantMessage: "Hello, the water heater is making noise 🙈",
      managerReply: "Thanks, I'm sending a plumber tomorrow!",
      signed: "Signed",
    },
    footer: {
      rights: "© 2026 ImmoPlatform Pro. All rights reserved.",
      tagline: "Secure rental property management software.",
      legal: "Legal notice",
      terms: "Terms & conditions",
      privacy: "Privacy",
    },
  },

};

export default zone;
