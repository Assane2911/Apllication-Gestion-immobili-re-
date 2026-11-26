import type { ZoneLanding } from "../fr/landing";

/** Textes de la page d'accueil publique, chargés avec elle. */
const zone: ZoneLanding = {
  landing: {
      reminders: {
        title: "Simulador · Recordatorios automáticos",
        subtitle: "Ajuste el plazo y el intervalo, como en los parámetros de su agencia.",
        grace: "Plazo antes del primer recordatorio",
        interval: "Intervalo entre dos recordatorios",
        days_one: "{{count}} día",
        days_other: "{{count}} días",
        day: "D+{{day}}",
        timeline: "Calendario de recordatorios de un alquiler impagado",
        steps: { due: "Vencimiento del alquiler", first: "Recordatorio amistoso", second: "Segundo recordatorio", third: "Último recordatorio", end: "Fin de los recordatorios automáticos: el resto le corresponde" },
        summary: "Recordatorio amistoso a D+{{first}}, segundo a D+{{second}}, último a D+{{third}}.",
        note: "Cada recordatorio sale por correo al titular y a los coinquilinos; WhatsApp con el plan Profesional. También puede avisar a los avalistas.",
        cta: "Activar los recordatorios durante la prueba",
      },
    stickyCta: "Pruébelo gratis",
    steps: {
      title: "Del registro al primer recibo",
      create: { title: "Cree su cuenta", desc: "Bastan unos minutos: un correo, el país de su agencia, y empieza la prueba de 15 días." },
      add: { title: "Añada sus inmuebles e inquilinos", desc: "Introduzca sus inmuebles, inquilinos y contratos, o impórtelos desde un archivo." },
      automate: { title: "Deje trabajar a la plataforma", desc: "Recibos, recordatorios de alquiler y seguimiento de rentabilidad sin volver a escribir nada." },
    },
    nav: {
      features: "Funcionalidades",
      vitrine: "Nuestros inmuebles",
      receipts: "Recibos y Firma",
      compare: "Comparativa",
      pricing: "Precios",
      currencies: "Multi-Divisas",
      security: "Seguridad",
      faq: "Preguntas frecuentes",
      goToSpace: "Ir a mi espacio →",
      login: "Iniciar sesión",
      trial: "Prueba gratis 15 días →",
      trialShort: "Prueba gratis →",
      top: "Volver arriba",
      menu: "Menú",
    },
    badge: "Nueva Versión 2.0 • 15 días de prueba gratuita sin compromiso",
    hero: {
      titleLine1: "La gestión de alquileres,",
      titleLine2: "reinventada y automatizada.",
      subtitle:
        "Genera sus recibos en PDF, firme sus contratos en línea, envíe sus recordatorios automáticos desde el día 1 de cada mes y siga su rentabilidad neta en tiempo real.",
      ctaTrial: "Comenzar la prueba gratuita de 15 días →",
      ctaPricing: "Ver precios",
    },
    features: {
      receipts: {
        title: "Recibos y Contratos en PDF",
        desc: "Descarga instantánea de los recibos de alquiler con sello de la agencia, número de serie y menciones legales en cuanto se confirma el pago.",
      },
      signature: {
        title: "Firma Táctil Electrónica",
        desc: "Haga firmar sus contratos de alquiler directamente desde el móvil o la tableta. Sellado de tiempo y archivo digital seguro.",
      },
      reminders: {
        title: "Alertas Automáticas el Día 1 de Cada Mes",
        desc: "Recordatorios programados el día 1 de cada mes que indican a cada inquilino la fecha límite de su propio alquiler, con enlace de pago seguro.",
      },
      dashboard: {
        title: "Panel de Control y Estadísticas en Tiempo Real",
        desc: "Consulte de un vistazo su tasa de ocupación, sus ingresos cobrados, sus facturas atrasadas y el estado de su cartera, con gráficos claros y actualizados en directo.",
      },
      expenses: {
        title: "Seguimiento de Gastos y Rentabilidad Neta",
        desc: "Registre sus gastos de mantenimiento, impuestos y cargas, y visualice automáticamente su flujo de caja real — ingresos menos gastos — mes a mes.",
      },
      tenantPortal: {
        title: "Portal del Inquilino Dedicado",
        desc: "Sus inquilinos pagan su alquiler, consultan sus recibos, reportan una incidencia con foto y le escriben directamente, sin llamadas ni papeleo.",
      },
      security: {
        title: "Seguridad y Cumplimiento RGPD",
        desc: "Aislamiento estricto de los datos entre agencias, contraseñas cifradas, conexiones seguras y alojamiento en Francia — conforme al RGPD desde el diseño.",
      },
      multiCurrency: {
        title: "Multi-Divisas",
        desc: "Muestre y cobre sus alquileres en la divisa que elija, adaptada a su mercado y al de sus inquilinos.",
      },
      multiLanguage: {
        title: "Interfaz Multilingüe",
        desc: "Francés, inglés, portugués y español: cada usuario elige su idioma de visualización con un clic, sin ninguna configuración.",
      },
    },
    featuresSection: {
      title: "Todo lo necesario para gestionar sus alquileres con tranquilidad",
      subtitle: "Una sola plataforma, desde el contrato hasta el cobro, tanto para independientes como para agencias.",
    },
    extras: [
      "Mensajería integrada",
      "Búsqueda global instantánea",
      "Registro de actividad completo",
      "Exportación contable CSV",
      "Marca blanca para su agencia",
    ],
    productTour: {
      title: "Descubra la plataforma en imágenes",
      subtitle: "Una interfaz pensada para ser rápida, tanto para usted como para sus inquilinos.",
      dashboard: {
        title: "Un panel de control claro y accionable",
        desc: "Ingresos, ocupación, facturas atrasadas e incidencias: todas sus prioridades del día, reunidas en una sola pantalla.",
      },
      contracts: {
        title: "Contratos firmados en unos pocos clics",
        desc: "Generación del contrato, firma táctil del inquilino, archivo automático — sin impresora ni escáner.",
      },
      expenses: {
        title: "Una rentabilidad siempre actualizada",
        desc: "Cada gasto registrado recalcula al instante su flujo de caja neto, propiedad por propiedad.",
      },
      tenant: {
        title: "Una experiencia fluida para el inquilino",
        desc: "Recibos, documentos para firmar y mensajería directa: sus inquilinos ya no le llaman por cualquier motivo.",
      },
    },
    forWho: {
      title: "Diseñado para todos los perfiles de gestión de alquileres",
      subtitle: "Ya gestione un estudio o varios cientos de propiedades, hay un plan hecho para usted.",
      independent: {
        title: "Propietario independiente",
        desc: "Gestiona sus pocas propiedades con toda sencillez: recibos automáticos, recordatorios de pago y portal del inquilino, sin complejidad innecesaria.",
      },
      agency: {
        title: "Agencia inmobiliaria",
        desc: "Firma electrónica, seguimiento de rentabilidad y marca blanca para presentar una imagen profesional a sus clientes propietarios e inquilinos.",
      },
      enterprise: {
        title: "Gestor de gran cartera",
        desc: "Multiusuario, exportación contable automatizada y soporte prioritario para gestionar cientos de propiedades sin perder visibilidad.",
      },
    },
    trust: {
      title: "Sus datos, protegidos en serio",
      subtitle: "La seguridad no es una opción añadida después: forma parte de la arquitectura del servicio.",
      items: [
        "Datos alojados en Francia (París), en una infraestructura dedicada.",
        "Aislamiento estricto de los datos entre agencias: ningún gestor puede ver las propiedades, inquilinos o pagos de otra agencia.",
        "Contraseñas cifradas y conexiones totalmente seguras mediante HTTPS.",
        "Política de privacidad conforme al RGPD, disponible para consultar en cualquier momento.",
      ],
      linkLabel: "Consultar nuestra política de privacidad →",
    },
    faq: {
      searchLabel: "Buscar en las preguntas frecuentes",
      searchPlaceholder: "Buscar una pregunta…",
      noResult: "Ninguna pregunta coincide con su búsqueda.",
      clearSearch: "Borrar la búsqueda",
      title: "Preguntas frecuentes",
      items: [
        {
          q: "¿Cuánto tiempo se tarda en empezar?",
          a: "Solo unos minutos: cree su cuenta, añada su primera propiedad y disfrute de inmediato de 15 días de prueba gratuita, sin necesidad de tarjeta bancaria.",
        },
        {
          q: "¿Mis datos están seguros?",
          a: "Sí: sus datos están alojados en Francia, cifrados y estrictamente aislados de las demás agencias que usan la plataforma. Consulte nuestra política de privacidad para más detalles.",
        },
        {
          q: "¿Qué métodos de pago pueden usar mis inquilinos?",
          a: "Sus inquilinos pagan el alquiler en línea (Mobile Money o tarjeta) directamente en la cuenta PayDunya de su agencia, que usted conecta en sus ajustes: el dinero no pasa por la plataforma. Un alquiler recibido de otra forma (efectivo, cheque, Mobile Money) se registra a mano, en un clic.",
        },
        {
          q: "¿Puedo cancelar mi suscripción en cualquier momento?",
          a: "Sí, sin compromiso. Puede cancelar desde su espacio de gestión en cualquier momento; el acceso permanece activo hasta el final del período ya pagado.",
        },
        {
          q: "¿El servicio funciona fuera de Francia?",
          a: "Sí: divisa de visualización personalizable, interfaz en 4 idiomas y métodos de pago adaptados tanto a África francófona como al ámbito internacional.",
        },
      ],
    },
    finalCta: {
      title: "¿Listo para modernizar su gestión de alquileres?",
      subtitle: "Únete a los gestores que ya han simplificado sus recibos, recordatorios y seguimiento financiero.",
      cta: "Comenzar mi prueba gratuita de 15 días →",
    },
    pricing: {
      perYear: "/ año",
      monthlyEquivalent: "es decir {{price}} / mes",
      currencyLabel: "Moneda",
      cycleLabel: "Periodo de facturación",
      monthly: "Mensual",
      annual: "Anual",
      annualSaving: "Pague al año: {{pct}} % de ahorro",
      advisor: {
        title: "Encontrar mi fórmula",
        label: "¿Cuántos inmuebles gestiona?",
        result_one: "Para {{count}} inmueble, le recomendamos",
        result_other: "Para {{count}} inmuebles, le recomendamos",
        upTo: "Hasta {{max}} inmuebles incluidos",
        unlimited: "Inmuebles ilimitados",
        perProperty: "es decir {{price}} por inmueble y mes",
        forYou_one: "Para sus {{count}} inmueble",
        forYou_other: "Para sus {{count}} inmuebles",
      },
      title: "Planes simples y transparentes",
      subtitle: "Todos los planes incluyen 15 días de prueba gratuita sin necesidad de tarjeta bancaria, con una guía de inicio paso a paso.",
      perMonth: "/ mes",
      starter: {
        name: "Starter",
        cta: "Comenzar la prueba de 15 días",
      },
      pro: {
        name: "Profesional",
        badge: "Recomendado",
        cta: "Comenzar la prueba gratuita de 15 días",
      },
      enterprise: {
        name: "Agencia y Multicuentas",
        cta: "Comenzar la prueba de 15 días",
      },
    },
    compare: {
      badge: "Comparativa y valor añadido",
      titlePrefix: "Gestión tradicional vs",
      subtitle:
        "Descubra por qué las agencias y los propietarios modernos abandonan las hojas de Excel, los mensajes de WhatsApp dispersos y el papeleo por una gestión de alquileres 100% automatizada.",
      roi: {
        adminTime: "Tiempo administrativo",
        unpaidRent: "Alquiler impagado olvidado",
        certified: "Contratos y recibos automatizados",
      },
      headers: {
        feature: "Funcionalidad y proceso",
        traditional: "Gestión tradicional (Excel / papel)",
        recommended: "Recomendado",
      },
      rows: {
        reminders: {
          title: "Avisos de vencimiento y recordatorios de alquiler",
          description: "Anticipación de los pagos y reducción de los impagos",
          traditional: "Olvidos frecuentes, llamadas incómodas, mensajes de WhatsApp dispersos, retrasos de pago habituales.",
          immoplatform: "Aviso de vencimiento automático el día 1 de cada mes, con recordatorio antes de la fecha de vencimiento fijada en el contrato. Facturas instantáneas con estado en directo.",
        },
        receipts: {
          title: "Recibos de alquiler automáticos",
          description: "Generación y entrega legal a los inquilinos",
          traditional: "Creación manual en Word/Excel, conversión a PDF tediosa, envíos por correo a menudo olvidados.",
          immoplatform: "Generación automática con 1 clic en PDF, con sello de la agencia, número único y menciones legales.",
        },
        signature: {
          title: "Firma de los contratos de alquiler",
          description: "Validación jurídica y formalización de los contratos",
          traditional: "Impresión en papel, rúbrica página por página, desplazamientos físicos obligatorios, contratos extraviados.",
          immoplatform: "Firma electrónica táctil (ordenador, tableta, móvil) con sello de tiempo en 2 minutos.",
        },
        incidents: {
          title: "Aviso de averías e incidencias",
          description: "Seguimiento de reparaciones y mantenimiento",
          traditional: "Llamadas de urgencia, descripciones vagas, fotos sin fecha, historial inexistente.",
          immoplatform: "Foto tomada directamente por el inquilino, galería en alta resolución para la agencia y seguimiento de la intervención en tiempo real.",
        },
        expenses: {
          title: "Seguimiento de gastos y flujo de caja neto",
          description: "Cálculo de la rentabilidad real y contabilidad",
          traditional: "Facturas de profesionales dispersas, cálculos manuales de fin de año, ninguna visibilidad sobre el rendimiento neto.",
          immoplatform: "Registro de gastos por categoría, cálculo automático del flujo de caja neto y exportación contable CSV con 1 clic.",
        },
        branding: {
          title: "Imagen de marca y multidivisa",
          description: "Profesionalidad y dimensión internacional",
          traditional: "Documentos neutros o poco profesionales, conversión manual sujeta a errores de cambio.",
          immoplatform: "Marca blanca de la agencia (logotipo, identificadores legales, membrete) y compatibilidad con el euro y el franco CFA (FCFA).",
        },
      },
      cta: {
        text: "¿Listo para modernizar hoy la gestión de su cartera inmobiliaria?",
        button: "Empezar 15 días de prueba gratuita →",
      },
    },
    mock: {
      netFlow: "Flujo neto",
      rentMonth: "Alquiler de septiembre",
      pay: "Pagar",
      tenantMessage: "Hola, el calentador hace ruido 🙈",
      managerReply: "¡Gracias, mañana envío a un fontanero!",
      signed: "Firmado",
    },
    footer: {
      rights: "© 2026 ImmoPlatform Pro. Todos los derechos reservados.",
      tagline: "Software de gestión de alquileres inmobiliarios seguro.",
      legal: "Aviso legal",
      terms: "Términos y condiciones",
      privacy: "Privacidad",
    },
  },

};

export default zone;
