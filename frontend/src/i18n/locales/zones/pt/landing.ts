import type { ZoneLanding } from "../fr/landing";

/** Textes de la page d'accueil publique, chargés avec elle. */
const zone: ZoneLanding = {
  landing: {
      reminders: {
        title: "Simulador · Lembretes automáticos",
        subtitle: "Defina o prazo e o intervalo, como nas definições da sua agência.",
        grace: "Prazo antes do primeiro lembrete",
        interval: "Intervalo entre dois lembretes",
        days_one: "{{count}} dia",
        days_other: "{{count}} dias",
        day: "D+{{day}}",
        timeline: "Calendário dos lembretes de uma renda por pagar",
        steps: { due: "Vencimento da renda", first: "Lembrete amigável", second: "Segundo lembrete", third: "Último lembrete", end: "Fim dos lembretes automáticos: o resto fica consigo" },
        summary: "Lembrete amigável em D+{{first}}, segundo em D+{{second}}, último em D+{{third}}.",
        note: "Cada lembrete segue por e-mail para o titular e os coarrendatários; WhatsApp com o plano Profissional. Pode também avisar os fiadores.",
        cta: "Ativar os lembretes durante o teste",
      },
    stickyCta: "Experimente grátis",
    steps: {
      title: "Do registo ao primeiro recibo",
      create: { title: "Crie a sua conta", desc: "Bastam alguns minutos: um email, o país da sua agência, e o teste de 15 dias começa." },
      add: { title: "Adicione os seus imóveis e inquilinos", desc: "Introduza os seus imóveis, inquilinos e contratos, ou importe-os de um ficheiro." },
      automate: { title: "Deixe a plataforma trabalhar", desc: "Recibos, lembretes de renda e acompanhamento da rentabilidade sem voltar a escrever nada." },
    },
    nav: {
      features: "Funcionalidades",
      vitrine: "Os nossos imóveis",
      receipts: "Recibos & Assinatura",
      compare: "Comparação",
      pricing: "Preços",
      currencies: "Multi-Moedas",
      security: "Segurança",
      faq: "FAQ",
      goToSpace: "Aceder à minha área →",
      login: "Iniciar sessão",
      trial: "Teste grátis de 15 dias →",
      trialShort: "Teste grátis →",
      top: "Voltar ao topo",
      menu: "Menu",
    },
    badge: "Nova Versão 2.0 • 15 dias de teste grátis, sem compromisso",
    hero: {
      titleLine1: "A gestão de arrendamento,",
      titleLine2: "reinventada & automatizada.",
      subtitle:
        "Gere os seus recibos de renda em PDF, faça assinar os contratos online, envie lembretes automáticos no dia 1 de cada mês e acompanhe a sua rentabilidade líquida em tempo real.",
      ctaTrial: "Iniciar o teste grátis de 15 dias →",
      ctaPricing: "Ver os preços",
    },
    features: {
      receipts: {
        title: "Recibos & Contratos em PDF",
        desc: "Descarregamento instantâneo dos recibos de renda com o carimbo da agência, número de série e menções legais assim que o pagamento é confirmado.",
      },
      signature: {
        title: "Assinatura Eletrónica Tátil",
        desc: "Faça assinar os seus contratos de arrendamento diretamente no smartphone ou tablet. Registo de data/hora e arquivo digital seguro.",
      },
      reminders: {
        title: "Alertas Automáticos no Dia 1 de Cada Mês",
        desc: "Lembretes programados no dia 1 de cada mês, indicando a cada inquilino o prazo da sua própria renda, com um link de pagamento seguro.",
      },
      dashboard: {
        title: "Painel & Estatísticas em Tempo Real",
        desc: "Acompanhe rapidamente a sua taxa de ocupação, as receitas recebidas, os pagamentos em atraso e o estado do seu património, com gráficos claros e atualizados em direto.",
      },
      expenses: {
        title: "Controlo de Despesas & Rentabilidade Líquida",
        desc: "Registe as suas despesas de manutenção, impostos e encargos, e veja automaticamente o seu fluxo de caixa real — receitas menos despesas — mês após mês.",
      },
      tenantPortal: {
        title: "Portal do Inquilino Dedicado",
        desc: "Os seus inquilinos pagam a renda, consultam os seus recibos, reportam uma ocorrência com foto e escrevem-lhe diretamente, sem chamadas nem papelada.",
      },
      security: {
        title: "Segurança & Conformidade RGPD",
        desc: "Isolamento estrito dos dados entre agências, palavras-passe encriptadas, ligações seguras e alojamento em França — conforme o RGPD desde a conceção.",
      },
      multiCurrency: {
        title: "Multi-Moedas",
        desc: "Exiba e receba as rendas na moeda da sua escolha, adaptada ao seu mercado e ao dos seus inquilinos.",
      },
      multiLanguage: {
        title: "Interface Multilingue",
        desc: "Francês, inglês, português e espanhol: cada utilizador escolhe o seu idioma de exibição num clique, sem qualquer configuração.",
      },
    },
    featuresSection: {
      title: "Tudo o que precisa para gerir os seus arrendamentos com tranquilidade",
      subtitle: "Uma única plataforma, do contrato ao recebimento, tanto para independentes como para agências.",
    },
    extras: [
      "Mensagens integradas",
      "Pesquisa global instantânea",
      "Registo de atividade completo",
      "Exportação contabilística CSV",
      "Marca branca para a sua agência",
    ],
    productTour: {
      title: "Descubra a plataforma em imagens",
      subtitle: "Uma interface pensada para ser rápida, tanto para si como para os seus inquilinos.",
      dashboard: {
        title: "Um painel claro e acionável",
        desc: "Receitas, ocupação, pagamentos em atraso e ocorrências: todas as suas prioridades do dia, reunidas num único ecrã.",
      },
      contracts: {
        title: "Contratos assinados em poucos cliques",
        desc: "Geração do contrato, assinatura tátil do inquilino, arquivo automático — sem impressora nem digitalizador.",
      },
      expenses: {
        title: "Uma rentabilidade sempre atualizada",
        desc: "Cada despesa registada recalcula instantaneamente o seu fluxo de caixa líquido, imóvel a imóvel.",
      },
      tenant: {
        title: "Uma experiência fluida para o inquilino",
        desc: "Recibos, documentos para assinar e mensagens diretas: os seus inquilinos deixam de lhe ligar por qualquer motivo.",
      },
    },
    forWho: {
      title: "Concebido para todos os perfis de gestão de arrendamento",
      subtitle: "Quer gira um estúdio ou várias centenas de imóveis, há um plano feito para si.",
      independent: {
        title: "Proprietário independente",
        desc: "Gira os seus poucos imóveis com toda a simplicidade: recibos automáticos, lembretes de pagamento e portal do inquilino, sem complexidade desnecessária.",
      },
      agency: {
        title: "Agência imobiliária",
        desc: "Assinatura eletrónica, controlo de rentabilidade e marca branca para apresentar uma imagem profissional aos seus clientes proprietários e inquilinos.",
      },
      enterprise: {
        title: "Gestor de grande património",
        desc: "Multiutilizadores, exportação contabilística automatizada e apoio prioritário para gerir centenas de imóveis sem perder visibilidade.",
      },
    },
    trust: {
      title: "Os seus dados, protegidos a sério",
      subtitle: "A segurança não é uma opção adicionada depois — faz parte da arquitetura do serviço.",
      items: [
        "Dados alojados em França (Paris), numa infraestrutura dedicada.",
        "Isolamento estrito dos dados entre agências: nenhum gestor consegue ver os imóveis, inquilinos ou pagamentos de outra agência.",
        "Palavras-passe encriptadas e ligações totalmente seguras em HTTPS.",
        "Política de privacidade conforme o RGPD, consultável a qualquer momento.",
      ],
      linkLabel: "Consultar a nossa política de privacidade →",
    },
    faq: {
      searchLabel: "Pesquisar nas perguntas frequentes",
      searchPlaceholder: "Pesquisar uma pergunta…",
      noResult: "Nenhuma pergunta corresponde à sua pesquisa.",
      clearSearch: "Limpar a pesquisa",
      title: "Perguntas frequentes",
      items: [
        {
          q: "Quanto tempo demora a começar?",
          a: "Apenas alguns minutos: crie a sua conta, adicione o seu primeiro imóvel e aproveite imediatamente 15 dias de teste grátis, sem necessidade de cartão bancário.",
        },
        {
          q: "Os meus dados estão seguros?",
          a: "Sim: os seus dados são alojados em França, encriptados e estritamente isolados das outras agências que utilizam a plataforma. Veja a nossa política de privacidade para mais detalhes.",
        },
        {
          q: "Que meios de pagamento os meus inquilinos podem utilizar?",
          a: "A transferência bancária para a conta da sua agência: o inquilino declara-a na aplicação e você marca a fatura como paga quando a receber. O pagamento da renda por cartão ou Mobile Money não é oferecido por agora.",
        },
        {
          q: "Posso cancelar a minha subscrição a qualquer momento?",
          a: "Sim, sem compromisso. Pode cancelar a partir da sua área de gestão a qualquer momento; o acesso mantém-se ativo até ao final do período já pago.",
        },
        {
          q: "O serviço funciona fora de França?",
          a: "Sim: moeda de exibição personalizável, interface em 4 idiomas e meios de pagamento adaptados tanto a África francófona como ao contexto internacional.",
        },
      ],
    },
    finalCta: {
      title: "Pronto para modernizar a sua gestão de arrendamento?",
      subtitle: "Junte-se aos gestores que já simplificaram os seus recibos, lembretes e acompanhamento financeiro.",
      cta: "Iniciar o meu teste grátis de 15 dias →",
    },
    pricing: {
      perYear: "/ ano",
      monthlyEquivalent: "ou seja {{price}} / mês",
      currencyLabel: "Moeda",
      cycleLabel: "Período de faturação",
      monthly: "Mensal",
      annual: "Anual",
      annualSaving: "Pague por ano: {{pct}} % de poupança",
      advisor: {
        title: "Encontrar a minha fórmula",
        label: "Quantos imóveis gere?",
        result_one: "Para {{count}} imóvel, recomendamos",
        result_other: "Para {{count}} imóveis, recomendamos",
        upTo: "Até {{max}} imóveis incluídos",
        unlimited: "Imóveis ilimitados",
        perProperty: "ou seja {{price}} por imóvel e por mês",
        forYou_one: "Para os seus {{count}} imóvel",
        forYou_other: "Para os seus {{count}} imóveis",
      },
      title: "Planos simples e transparentes",
      subtitle: "Todos os planos incluem 15 dias de teste grátis, sem necessidade de cartão bancário, com um guia de início passo a passo.",
      perMonth: "/ mês",
      starter: {
        name: "Starter",
        cta: "Iniciar o teste de 15 dias",
      },
      pro: {
        name: "Profissional",
        badge: "Recomendado",
        cta: "Iniciar o teste grátis de 15 dias",
      },
      enterprise: {
        name: "Agência e Multicontas",
        cta: "Iniciar o teste de 15 dias",
      },
    },
    compare: {
      badge: "Comparação e Valor Acrescentado",
      titlePrefix: "Gestão tradicional vs",
      subtitle:
        "Descubra por que razão as agências e os proprietários modernos abandonam as folhas de Excel, as conversas de WhatsApp dispersas e a papelada por uma gestão de arrendamentos 100% automatizada.",
      roi: {
        adminTime: "Tempo administrativo",
        unpaidRent: "Renda em atraso esquecida",
        certified: "Contratos e recibos automatizados",
      },
      headers: {
        feature: "Funcionalidade e processo",
        traditional: "Gestão tradicional (Excel / papel)",
        recommended: "Recomendado",
      },
      rows: {
        reminders: {
          title: "Avisos de vencimento e lembretes de renda",
          description: "Antecipação dos pagamentos e redução das rendas em atraso",
          traditional: "Esquecimentos frequentes, chamadas incómodas, mensagens de WhatsApp dispersas, atrasos de pagamento regulares.",
          immoplatform: "Aviso de vencimento automático no dia 1 de cada mês, com lembrete antes da data de vencimento fixada no contrato. Faturas instantâneas com estado em direto.",
        },
        receipts: {
          title: "Recibos de renda automáticos",
          description: "Geração e entrega legal aos inquilinos",
          traditional: "Criação manual em Word/Excel, conversão em PDF fastidiosa, envios por email muitas vezes esquecidos.",
          immoplatform: "Geração automática com 1 clique em PDF, com carimbo da agência, número único e menções legais.",
        },
        signature: {
          title: "Assinatura dos contratos de arrendamento",
          description: "Validação jurídica e celebração dos contratos",
          traditional: "Impressão em papel, rubrica página a página, deslocações físicas obrigatórias, contratos extraviados.",
          immoplatform: "Assinatura eletrónica tátil (computador, tablet, telemóvel) com carimbo de data/hora em 2 minutos.",
        },
        incidents: {
          title: "Comunicação de avarias e incidentes",
          description: "Acompanhamento das reparações e da manutenção",
          traditional: "Chamadas de urgência, descrições vagas, fotografias sem data, histórico inexistente.",
          immoplatform: "Fotografia tirada diretamente pelo inquilino, galeria em alta resolução para a agência e acompanhamento da intervenção em tempo real.",
        },
        expenses: {
          title: "Acompanhamento de despesas e fluxo de caixa líquido",
          description: "Cálculo da rentabilidade real e contabilidade",
          traditional: "Faturas de profissionais dispersas, cálculos manuais de fim de ano, nenhuma visibilidade sobre o rendimento líquido.",
          immoplatform: "Registo das despesas por categoria, cálculo automático do fluxo de caixa líquido e exportação contabilística CSV com 1 clique.",
        },
        branding: {
          title: "Imagem de marca e multimoeda",
          description: "Profissionalismo e dimensão internacional",
          traditional: "Documentos neutros ou pouco profissionais, conversão manual sujeita a erros de câmbio.",
          immoplatform: "Marca branca da agência (logótipo, identificadores legais, cabeçalho) e suporte ao euro e ao franco CFA (FCFA).",
        },
      },
      cta: {
        text: "Pronto para modernizar hoje a gestão do seu parque imobiliário?",
        button: "Começar 15 dias de teste gratuito →",
      },
    },
    mock: {
      netFlow: "Fluxo líquido",
      rentMonth: "Renda de setembro",
      pay: "Pagar",
      tenantMessage: "Olá, o esquentador faz barulho 🙈",
      managerReply: "Obrigado, envio um canalizador amanhã!",
      signed: "Assinado",
    },
    footer: {
      rights: "© 2026 ImmoPlatform Pro. Todos os direitos reservados.",
      tagline: "Software de gestão de arrendamento imobiliário seguro.",
      legal: "Aviso legal",
      terms: "Termos e condições",
      privacy: "Privacidade",
    },
  },

};

export default zone;
