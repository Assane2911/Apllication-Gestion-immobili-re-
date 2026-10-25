import type { Langue } from "../utils/langue";

/**
 * Textes des e-mails qu'un locataire reçoit sans les avoir demandés : avis d'échéance, rappel avant échéance, relances
 * d'impayé, quittance et reçu de paiement partiel. La mise en page est dans email.service.ts ; ici, seulement les mots.
 *
 * Les fonctions reçoivent des valeurs DÉJÀ prêtes pour le HTML (noms échappés, dates et montants mis en forme dans la
 * langue du destinataire). Le français est le texte d'origine, repris tel quel.
 *
 * Le ton suit l'usage de chaque langue pour une agence qui écrit à son locataire : « vous », « usted », « você ».
 */
export interface TextesLocataire {
  avisEcheance: {
    sujet: (mois: string, annee: number, dateLimite: string) => string;
    bandeau: string;
    sousTitre: (mois: string, annee: number, bien: string) => string;
    bonjour: (nom: string) => string;
    intro: (mois: string, annee: number, bien: string) => string;
    montantLabel: string;
    delai: (date: string) => string;
    conformite: string;
    bouton: string;
    moyens: string;
    pied: string;
  };
  rappelAvantEcheance: {
    sujet: (mois: string, jours: number) => string;
    bandeau: string;
    bonjour: (nom: string) => string;
    intro: (mois: string, annee: number, bien: string, date: string, jours: number) => string;
    bouton: string;
    pied: string;
  };
  relance: {
    titres: Record<1 | 2 | 3, string>;
    corps: Record<1 | 2 | 3, (periode: string) => string>;
    bonjour: (nom: string) => string;
    resteAPayer: string;
    echeance: (date: string, joursDeRetard: number) => string;
    instruction: string;
  };
  quittance: {
    sujet: (mois: string, annee: number) => string;
    titre: string;
    bonjour: (nom: string) => string;
    corps: (mois: string, annee: number, bien: string, montant: string) => string;
    jointe: string;
  };
  recuPartiel: {
    sujet: (mois: string, annee: number) => string;
    titre: string;
    bonjour: (nom: string) => string;
    corps: (montant: string, date: string, moyen: string, mois: string, annee: number, bien: string) => string;
    loyer: string;
    dejaRegle: string;
    reste: string;
    note: string;
  };
}

const fr: TextesLocataire = {
  avisEcheance: {
    sujet: (mois, annee, dateLimite) => `📢 Échéance de loyer ${mois} ${annee} — Règlement attendu au plus tard le ${dateLimite}`,
    bandeau: "Avis d'Échéance de Loyer",
    sousTitre: (mois, annee, bien) => `${mois} ${annee} • ${bien}`,
    bonjour: (nom) => `Bonjour <strong>${nom}</strong>,`,
    intro: (mois, annee, bien) =>
      `Votre avis d'échéance de loyer pour le mois de <strong>${mois} ${annee}</strong> concernant le bien <strong>${bien}</strong> est désormais émis.`,
    montantLabel: "Montant à régler",
    delai: (date) => `⏰ Date limite de règlement : au plus tard le ${date}`,
    conformite: "Conformément à votre bail de location, nous vous remercions de procéder au paiement de votre loyer dans les délais impartis.",
    bouton: "Régler mon loyer →",
    moyens: "Moyens acceptés : Carte bancaire, PayDunya (Orange Money, Wave, MTN...), virement bancaire.",
    pied: "Cet email vous a été envoyé automatiquement par votre agence de gestion immobilière.",
  },
  rappelAvantEcheance: {
    sujet: (mois, jours) => `⏰ Rappel : votre loyer de ${mois} arrive à échéance dans ${jours} jour(s)`,
    bandeau: "⏰ Rappel avant échéance",
    bonjour: (nom) => `Bonjour <strong>${nom}</strong>,`,
    intro: (mois, annee, bien, date, jours) =>
      `Votre loyer de <strong>${mois} ${annee}</strong> pour le logement <strong>${bien}</strong> n'a pas encore été réglé et arrive à échéance le <strong>${date}</strong> (dans ${jours} jour${jours > 1 ? "s" : ""}).`,
    bouton: "Régler mon loyer maintenant →",
    pied: "Cet email vous a été envoyé automatiquement par votre agence de gestion immobilière.",
  },
  relance: {
    titres: { 1: "Rappel : loyer non réglé", 2: "Deuxième relance : loyer impayé", 3: "Dernière relance : loyer impayé" },
    corps: {
      1: (p) =>
        `Sauf erreur de notre part, le loyer de <strong>${p}</strong> n'a pas encore été réglé. S'il s'agit d'un oubli, merci de procéder au règlement dès que possible. Si vous avez déjà payé, vous pouvez ignorer ce message.`,
      2: (p) =>
        `Malgré notre précédent rappel, le loyer de <strong>${p}</strong> reste impayé. Merci de le régler sans attendre, ou de contacter votre agence si vous rencontrez une difficulté.`,
      3: (p) =>
        `Le loyer de <strong>${p}</strong> reste impayé malgré nos relances. Sans règlement ou prise de contact rapide de votre part, votre agence pourra donner à cet impayé les suites prévues par votre bail.`,
    },
    bonjour: (nom) => `Bonjour <strong>${nom}</strong>,`,
    resteAPayer: "Reste à payer",
    echeance: (date, jours) => `Échéance du ${date} — dépassée de ${jours} jour(s)`,
    instruction: "Vous pouvez régler ce loyer depuis votre espace locataire.",
  },
  quittance: {
    sujet: (mois, annee) => `Quittance de loyer — ${mois} ${annee}`,
    titre: "✅ Paiement de loyer confirmé",
    bonjour: (nom) => `Bonjour ${nom},`,
    corps: (mois, annee, bien, montant) =>
      `Nous confirmons la bonne réception de votre paiement de loyer pour <strong>${mois} ${annee}</strong> concernant le logement <strong>${bien}</strong>, d'un montant de <strong>${montant}</strong>.`,
    jointe: "Votre quittance de loyer est jointe à cet email au format PDF.",
  },
  recuPartiel: {
    sujet: (mois, annee) => `Reçu de paiement partiel — loyer ${mois} ${annee}`,
    titre: "Reçu de paiement partiel",
    bonjour: (nom) => `Bonjour ${nom},`,
    corps: (montant, date, moyen, mois, annee, bien) =>
      `Nous avons bien reçu un paiement de <strong>${montant}</strong> le ${date} (${moyen}) au titre du loyer de <strong>${mois} ${annee}</strong>, logement <strong>${bien}</strong>.`,
    loyer: "Loyer",
    dejaRegle: "Déjà réglé",
    reste: "Reste à payer",
    note: "Ce document est un <strong>reçu de paiement partiel</strong>, et non une quittance de loyer : la quittance vous sera délivrée lorsque le loyer sera intégralement réglé.",
  },
};

const en: TextesLocataire = {
  avisEcheance: {
    sujet: (mois, annee, dateLimite) => `📢 Rent due ${mois} ${annee} — Payment expected by ${dateLimite} at the latest`,
    bandeau: "Rent Due Notice",
    sousTitre: (mois, annee, bien) => `${mois} ${annee} • ${bien}`,
    bonjour: (nom) => `Hello <strong>${nom}</strong>,`,
    intro: (mois, annee, bien) => `Your rent notice for <strong>${mois} ${annee}</strong> for the property <strong>${bien}</strong> has now been issued.`,
    montantLabel: "Amount due",
    delai: (date) => `⏰ Payment deadline: no later than ${date}`,
    conformite: "In accordance with your lease, please pay your rent within the agreed time.",
    bouton: "Pay my rent →",
    moyens: "Accepted methods: bank card, PayDunya (Orange Money, Wave, MTN...), bank transfer.",
    pied: "This email was sent to you automatically by your property management agency.",
  },
  rappelAvantEcheance: {
    sujet: (mois, jours) => `⏰ Reminder: your ${mois} rent is due in ${jours} day(s)`,
    bandeau: "⏰ Reminder before the due date",
    bonjour: (nom) => `Hello <strong>${nom}</strong>,`,
    intro: (mois, annee, bien, date, jours) =>
      `Your <strong>${mois} ${annee}</strong> rent for the property <strong>${bien}</strong> has not been paid yet and is due on <strong>${date}</strong> (in ${jours} day${jours > 1 ? "s" : ""}).`,
    bouton: "Pay my rent now →",
    pied: "This email was sent to you automatically by your property management agency.",
  },
  relance: {
    titres: { 1: "Reminder: rent not paid", 2: "Second reminder: rent unpaid", 3: "Final reminder: rent unpaid" },
    corps: {
      1: (p) =>
        `Unless we are mistaken, the rent for <strong>${p}</strong> has not been paid yet. If it was an oversight, please pay as soon as possible. If you have already paid, you can ignore this message.`,
      2: (p) =>
        `Despite our previous reminder, the rent for <strong>${p}</strong> remains unpaid. Please pay it without delay, or contact your agency if you are having difficulty.`,
      3: (p) =>
        `The rent for <strong>${p}</strong> remains unpaid despite our reminders. Without payment or prompt contact from you, your agency may take the action provided for in your lease.`,
    },
    bonjour: (nom) => `Hello <strong>${nom}</strong>,`,
    resteAPayer: "Amount remaining",
    echeance: (date, jours) => `Due on ${date} — ${jours} day(s) overdue`,
    instruction: "You can pay this rent from your tenant portal.",
  },
  quittance: {
    sujet: (mois, annee) => `Rent receipt — ${mois} ${annee}`,
    titre: "✅ Rent payment confirmed",
    bonjour: (nom) => `Hello ${nom},`,
    corps: (mois, annee, bien, montant) =>
      `We confirm receipt of your rent payment for <strong>${mois} ${annee}</strong> for the property <strong>${bien}</strong>, in the amount of <strong>${montant}</strong>.`,
    jointe: "Your rent receipt is attached to this email as a PDF. The receipt document itself is issued in French.",
  },
  recuPartiel: {
    sujet: (mois, annee) => `Partial payment receipt — ${mois} ${annee} rent`,
    titre: "Partial payment receipt",
    bonjour: (nom) => `Hello ${nom},`,
    corps: (montant, date, moyen, mois, annee, bien) =>
      `We have received a payment of <strong>${montant}</strong> on ${date} (${moyen}) towards the rent for <strong>${mois} ${annee}</strong>, property <strong>${bien}</strong>.`,
    loyer: "Rent",
    dejaRegle: "Already paid",
    reste: "Remaining balance",
    note: "This document is a <strong>partial payment receipt</strong>, not a rent receipt: the rent receipt will be issued once the rent has been paid in full.",
  },
};

const es: TextesLocataire = {
  avisEcheance: {
    sujet: (mois, annee, dateLimite) => `📢 Vencimiento del alquiler ${mois} ${annee} — Pago esperado a más tardar el ${dateLimite}`,
    bandeau: "Aviso de vencimiento del alquiler",
    sousTitre: (mois, annee, bien) => `${mois} ${annee} • ${bien}`,
    bonjour: (nom) => `Hola <strong>${nom}</strong>,`,
    intro: (mois, annee, bien) => `Su aviso de vencimiento del alquiler de <strong>${mois} ${annee}</strong> del inmueble <strong>${bien}</strong> ya ha sido emitido.`,
    montantLabel: "Importe a pagar",
    delai: (date) => `⏰ Fecha límite de pago: a más tardar el ${date}`,
    conformite: "De conformidad con su contrato de alquiler, le agradecemos que pague su alquiler dentro del plazo establecido.",
    bouton: "Pagar mi alquiler →",
    moyens: "Medios aceptados: tarjeta bancaria, PayDunya (Orange Money, Wave, MTN...), transferencia bancaria.",
    pied: "Este correo se le ha enviado automáticamente desde su agencia de gestión inmobiliaria.",
  },
  rappelAvantEcheance: {
    sujet: (mois, jours) => `⏰ Recordatorio: su alquiler de ${mois} vence en ${jours} día(s)`,
    bandeau: "⏰ Recordatorio antes del vencimiento",
    bonjour: (nom) => `Hola <strong>${nom}</strong>,`,
    intro: (mois, annee, bien, date, jours) =>
      `Su alquiler de <strong>${mois} ${annee}</strong> del inmueble <strong>${bien}</strong> aún no se ha pagado y vence el <strong>${date}</strong> (dentro de ${jours} día${jours > 1 ? "s" : ""}).`,
    bouton: "Pagar mi alquiler ahora →",
    pied: "Este correo se le ha enviado automáticamente desde su agencia de gestión inmobiliaria.",
  },
  relance: {
    titres: { 1: "Recordatorio: alquiler sin pagar", 2: "Segundo aviso: alquiler impagado", 3: "Último aviso: alquiler impagado" },
    corps: {
      1: (p) =>
        `Salvo error por nuestra parte, el alquiler de <strong>${p}</strong> aún no se ha pagado. Si se trata de un olvido, le rogamos que lo pague lo antes posible. Si ya lo ha pagado, puede ignorar este mensaje.`,
      2: (p) =>
        `A pesar de nuestro recordatorio anterior, el alquiler de <strong>${p}</strong> sigue sin pagarse. Le rogamos que lo pague sin demora, o que se ponga en contacto con su agencia si tiene alguna dificultad.`,
      3: (p) =>
        `El alquiler de <strong>${p}</strong> sigue sin pagarse a pesar de nuestros recordatorios. Si no recibimos el pago o un contacto rápido por su parte, su agencia podrá dar a este impago el curso previsto en su contrato.`,
    },
    bonjour: (nom) => `Hola <strong>${nom}</strong>,`,
    resteAPayer: "Pendiente de pago",
    echeance: (date, jours) => `Vencimiento el ${date} — con ${jours} día(s) de retraso`,
    instruction: "Puede pagar este alquiler desde su espacio de inquilino.",
  },
  quittance: {
    sujet: (mois, annee) => `Recibo de alquiler — ${mois} ${annee}`,
    titre: "✅ Pago del alquiler confirmado",
    bonjour: (nom) => `Hola ${nom},`,
    corps: (mois, annee, bien, montant) =>
      `Confirmamos la recepción de su pago del alquiler de <strong>${mois} ${annee}</strong> del inmueble <strong>${bien}</strong>, por un importe de <strong>${montant}</strong>.`,
    jointe: "Su recibo de alquiler se adjunta a este correo en formato PDF. El documento del recibo se emite en francés.",
  },
  recuPartiel: {
    sujet: (mois, annee) => `Recibo de pago parcial — alquiler de ${mois} ${annee}`,
    titre: "Recibo de pago parcial",
    bonjour: (nom) => `Hola ${nom},`,
    corps: (montant, date, moyen, mois, annee, bien) =>
      `Hemos recibido un pago de <strong>${montant}</strong> el ${date} (${moyen}) a cuenta del alquiler de <strong>${mois} ${annee}</strong>, inmueble <strong>${bien}</strong>.`,
    loyer: "Alquiler",
    dejaRegle: "Ya pagado",
    reste: "Pendiente de pago",
    note: "Este documento es un <strong>recibo de pago parcial</strong> y no un recibo de alquiler: el recibo de alquiler se le entregará cuando el alquiler se haya pagado íntegramente.",
  },
};

const pt: TextesLocataire = {
  avisEcheance: {
    sujet: (mois, annee, dateLimite) => `📢 Vencimento do aluguel ${mois} ${annee} — Pagamento esperado até ${dateLimite}`,
    bandeau: "Aviso de vencimento do aluguel",
    sousTitre: (mois, annee, bien) => `${mois} ${annee} • ${bien}`,
    bonjour: (nom) => `Olá <strong>${nom}</strong>,`,
    intro: (mois, annee, bien) => `Seu aviso de vencimento do aluguel de <strong>${mois} ${annee}</strong> referente ao imóvel <strong>${bien}</strong> já foi emitido.`,
    montantLabel: "Valor a pagar",
    delai: (date) => `⏰ Prazo de pagamento: até ${date}`,
    conformite: "Conforme o seu contrato de locação, pedimos que efetue o pagamento do aluguel dentro do prazo.",
    bouton: "Pagar meu aluguel →",
    moyens: "Meios aceitos: cartão bancário, PayDunya (Orange Money, Wave, MTN...), transferência bancária.",
    pied: "Este e-mail foi enviado automaticamente pela sua imobiliária.",
  },
  rappelAvantEcheance: {
    sujet: (mois, jours) => `⏰ Lembrete: seu aluguel de ${mois} vence em ${jours} dia(s)`,
    bandeau: "⏰ Lembrete antes do vencimento",
    bonjour: (nom) => `Olá <strong>${nom}</strong>,`,
    intro: (mois, annee, bien, date, jours) =>
      `Seu aluguel de <strong>${mois} ${annee}</strong> referente ao imóvel <strong>${bien}</strong> ainda não foi pago e vence em <strong>${date}</strong> (em ${jours} dia${jours > 1 ? "s" : ""}).`,
    bouton: "Pagar meu aluguel agora →",
    pied: "Este e-mail foi enviado automaticamente pela sua imobiliária.",
  },
  relance: {
    titres: { 1: "Lembrete: aluguel não pago", 2: "Segundo aviso: aluguel em atraso", 3: "Último aviso: aluguel em atraso" },
    corps: {
      1: (p) =>
        `Salvo engano da nossa parte, o aluguel de <strong>${p}</strong> ainda não foi pago. Se foi um esquecimento, pedimos que efetue o pagamento o mais rápido possível. Se já pagou, pode ignorar esta mensagem.`,
      2: (p) =>
        `Apesar do nosso lembrete anterior, o aluguel de <strong>${p}</strong> continua em atraso. Pedimos que o pague sem demora, ou que entre em contato com a sua imobiliária se estiver com dificuldade.`,
      3: (p) =>
        `O aluguel de <strong>${p}</strong> continua em atraso apesar dos nossos lembretes. Sem o pagamento ou um contato rápido da sua parte, a sua imobiliária poderá dar a este atraso o encaminhamento previsto no seu contrato.`,
    },
    bonjour: (nom) => `Olá <strong>${nom}</strong>,`,
    resteAPayer: "Valor em aberto",
    echeance: (date, jours) => `Vencimento em ${date} — ${jours} dia(s) de atraso`,
    instruction: "Você pode pagar este aluguel pelo seu espaço do inquilino.",
  },
  quittance: {
    sujet: (mois, annee) => `Recibo de aluguel — ${mois} ${annee}`,
    titre: "✅ Pagamento do aluguel confirmado",
    bonjour: (nom) => `Olá ${nom},`,
    corps: (mois, annee, bien, montant) =>
      `Confirmamos o recebimento do seu pagamento do aluguel de <strong>${mois} ${annee}</strong> referente ao imóvel <strong>${bien}</strong>, no valor de <strong>${montant}</strong>.`,
    jointe: "Seu recibo de aluguel segue anexo a este e-mail em formato PDF. O documento do recibo é emitido em francês.",
  },
  recuPartiel: {
    sujet: (mois, annee) => `Recibo de pagamento parcial — aluguel de ${mois} ${annee}`,
    titre: "Recibo de pagamento parcial",
    bonjour: (nom) => `Olá ${nom},`,
    corps: (montant, date, moyen, mois, annee, bien) =>
      `Recebemos um pagamento de <strong>${montant}</strong> em ${date} (${moyen}) referente ao aluguel de <strong>${mois} ${annee}</strong>, imóvel <strong>${bien}</strong>.`,
    loyer: "Aluguel",
    dejaRegle: "Já pago",
    reste: "Valor em aberto",
    note: "Este documento é um <strong>recibo de pagamento parcial</strong>, e não um recibo de aluguel: o recibo de aluguel será emitido quando o aluguel for integralmente pago.",
  },
};

export const TEXTES_LOCATAIRE: Record<Langue, TextesLocataire> = { fr, en, es, pt };
