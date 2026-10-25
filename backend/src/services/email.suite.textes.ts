import type { Langue } from "../utils/langue";

/**
 * Textes des e-mails du lot 2B : statut d'un signalement, nouveau message de l'agence, révision de loyer (au locataire),
 * avis d'impayé au garant (dans la langue du locataire qu'il garantit), reversement (au propriétaire), fin de contrat,
 * échéance d'assurance et récompense de parrainage (au gestionnaire). La mise en page est dans email.service.ts.
 *
 * Les fonctions reçoivent des valeurs DÉJÀ prêtes pour le HTML (noms échappés, dates et montants mis en forme dans la
 * langue du destinataire), sauf les sujets, en texte brut. Le français est le texte d'origine, repris tel quel.
 *
 * Ton : « vous », « usted », « você » pour l'agence qui écrit à un locataire, à un propriétaire ou à un garant ; « tu »
 * en espagnol pour les messages de l'application au gestionnaire (comme les e-mails de compte).
 */
export interface TextesSuite {
  guillemets: [ouvrant: string, fermant: string];
  signalement: {
    statuts: Record<"OPEN" | "IN_PROGRESS" | "RESOLVED" | "REJECTED", string>;
    sujet: (emoji: string, titre: string) => string;
    titre: (emoji: string) => string;
    bonjour: (nom: string) => string;
    intro: (titre: string, bien: string) => string;
    intervention: (date: string) => string;
    note: string;
    bouton: string;
  };
  message: {
    sujet: (bien: string) => string;
    titre: string;
    bonjour: (nom: string) => string;
    intro: (bien: string) => string;
    bouton: string;
  };
  revision: {
    sujet: (date: string) => string;
    bandeau: string;
    bonjour: (nom: string) => string;
    intro: (bien: string, date: string) => string;
    loyerActuel: string;
    nouveauLoyer: string;
    base: string;
    suite: string;
    /** Mots du motif (« +3 % », « IRL : 142,06 → 145,47 »). */
    motif: { indice: string; separateurDecimal: "," | "."; pourcent: string; deuxPoints: string };
  };
  reversement: {
    sujet: (periode: string) => string;
    bandeau: string;
    bonjour: (nom: string) => string;
    intro: (date: string, moyen: string, periode: string) => string;
    reference: (reference: string) => string;
    detail: string;
    moyens: Record<"BANK_TRANSFER" | "CASH" | "CHEQUE" | "MOBILE_MONEY" | "OTHER", string>;
  };
  garant: {
    sujet: (locataire: string, periode: string) => string;
    bonjour: (nom: string) => string;
    corps: (locataire: string, bien: string, periode: string, montant: string) => string;
    plafond: (montant: string) => string;
    contact: (agence: string) => string;
  };
  finDeContrat: {
    sujet: (bien: string, jours: number) => string;
    titre: string;
    intro: (locataire: string, bien: string, date: string, jours: number) => string;
    conseil: string;
  };
  assurance: {
    sujet: (bien: string, jours: number) => string;
    titre: string;
    intro: (police: string, assureur: string, bien: string, date: string, jours: number) => string;
    conseil: string;
  };
  parrainage: {
    sujet: (jours: number) => string;
    titre: string;
    intro: (jours: number) => string;
    nouvelleEcheance: string;
    suite: string;
    bouton: string;
  };
}

const fr: TextesSuite = {
  guillemets: ["« ", " »"],
  signalement: {
    statuts: { OPEN: "Ouvert", IN_PROGRESS: "En cours de traitement", RESOLVED: "Résolu", REJECTED: "Rejeté" },
    sujet: (emoji, titre) => `${emoji} Mise à jour de votre signalement — ${titre}`,
    titre: (emoji) => `${emoji} Mise à jour de votre incident signalé`,
    bonjour: (nom) => `Bonjour ${nom},`,
    intro: (titre, bien) =>
      `Le statut de votre signalement <strong>« ${titre} »</strong> concernant le logement <strong>${bien}</strong> a été mis à jour :`,
    intervention: (date) =>
      `<strong>📅 Intervention prévue le ${date}</strong><br/>Merci de vous assurer d'être présent ou de prévoir un accès au logement.`,
    note: "Message de votre agence :",
    bouton: "Voir mes signalements →",
  },
  message: {
    sujet: (bien) => `💬 Nouveau message de votre agence — ${bien}`,
    titre: "💬 Nouveau message de votre agence",
    bonjour: (nom) => `Bonjour ${nom},`,
    intro: (bien) => `Vous avez reçu un nouveau message concernant le logement <strong>${bien}</strong> :`,
    bouton: "Répondre au message →",
  },
  revision: {
    sujet: (date) => `Révision de votre loyer à compter du ${date}`,
    bandeau: "Révision du loyer",
    bonjour: (nom) => `Bonjour <strong>${nom}</strong>,`,
    intro: (bien, date) => `Votre loyer pour le bien <strong>${bien}</strong> est révisé à compter du <strong>${date}</strong>.`,
    loyerActuel: "Loyer actuel :",
    nouveauLoyer: "Nouveau loyer mensuel",
    base: "Base de calcul :",
    suite:
      "Les avis d'échéance émis à partir de cette date porteront ce nouveau montant. Pour toute question, répondez à votre gestionnaire.",
    motif: { indice: "indice", separateurDecimal: ",", pourcent: " %", deuxPoints: " : " },
  },
  reversement: {
    sujet: (periode) => `Reversement de vos loyers — ${periode}`,
    bandeau: "Reversement effectué",
    bonjour: (nom) => `Bonjour <strong>${nom}</strong>,`,
    intro: (date, moyen, periode) =>
      `Votre agence vous a versé le ${date} (${moyen}) la somme suivante, au titre de la gestion de <strong>${periode}</strong> :`,
    reference: (reference) => `Référence : ${reference}`,
    detail:
      "Le détail (loyers encaissés, charges, commission) figure dans votre compte-rendu de gestion, disponible dans votre espace propriétaire.",
    moyens: { BANK_TRANSFER: "virement", CASH: "espèces", CHEQUE: "chèque", MOBILE_MONEY: "mobile money", OTHER: "autre moyen" },
  },
  garant: {
    sujet: (locataire, periode) => `Information : loyer impayé de ${locataire} — ${periode}`,
    bonjour: (nom) => `Bonjour <strong>${nom}</strong>,`,
    corps: (locataire, bien, periode, montant) =>
      `Vous êtes garant du bail de <strong>${locataire}</strong> pour le logement <strong>${bien}</strong>. Nous vous informons que le loyer de <strong>${periode}</strong> reste impayé malgré nos relances, pour un montant de <strong>${montant}</strong>.`,
    plafond: (montant) => `Pour mémoire, le montant maximal que vous avez garanti est de <strong>${montant}</strong>.`,
    contact: (agence) => `Pour toute question, vous pouvez contacter ${agence}.`,
  },
  finDeContrat: {
    sujet: (bien, jours) => `Rappel : fin de contrat dans ${jours} jours — ${bien}`,
    titre: "Rappel de fin de contrat de location",
    intro: (locataire, bien, date, jours) =>
      `Le contrat de location de <strong>${locataire}</strong> pour le bien <strong>${bien}</strong> arrive à échéance le <strong>${date}</strong> (dans ${jours} jours).`,
    conseil:
      "Pensez à contacter le locataire pour discuter d'un renouvellement, d'un état des lieux de sortie ou de la libération du bien.",
  },
  assurance: {
    sujet: (bien, jours) => `Rappel : police d'assurance à renouveler dans ${jours} jours — ${bien}`,
    titre: "Rappel d'échéance d'assurance",
    intro: (police, assureur, bien, date, jours) =>
      `La police d'assurance <strong>${police}</strong> souscrite auprès de <strong>${assureur}</strong> pour le bien <strong>${bien}</strong> arrive à échéance le <strong>${date}</strong> (dans ${jours} jours).`,
    conseil: "Pensez à contacter votre assureur pour renouveler le contrat ou en souscrire un nouveau avant cette date.",
  },
  parrainage: {
    sujet: (jours) => `🎁 +${jours} jours offerts — votre filleul a rejoint ImmoPlatform Pro`,
    titre: "🎁 Merci pour votre parrainage !",
    intro: (jours) =>
      `La personne que vous avez parrainée vient de confirmer son compte. En remerciement, <strong>${jours} jours</strong> ont été ajoutés à votre accès.`,
    nouvelleEcheance: "Nouvelle échéance",
    suite: "Continuez à partager votre code de parrainage pour prolonger votre accès à chaque nouveau filleul confirmé.",
    bouton: "Voir mon programme de parrainage →",
  },
};

const en: TextesSuite = {
  guillemets: ["“", "”"],
  signalement: {
    statuts: { OPEN: "Open", IN_PROGRESS: "In progress", RESOLVED: "Resolved", REJECTED: "Rejected" },
    sujet: (emoji, titre) => `${emoji} Update on your report — ${titre}`,
    titre: (emoji) => `${emoji} Update on the incident you reported`,
    bonjour: (nom) => `Hello ${nom},`,
    intro: (titre, bien) => `The status of your report <strong>“${titre}”</strong> for the property <strong>${bien}</strong> has been updated:`,
    intervention: (date) =>
      `<strong>📅 Intervention scheduled on ${date}</strong><br/>Please make sure you are present or arrange access to the property.`,
    note: "Message from your agency:",
    bouton: "View my reports →",
  },
  message: {
    sujet: (bien) => `💬 New message from your agency — ${bien}`,
    titre: "💬 New message from your agency",
    bonjour: (nom) => `Hello ${nom},`,
    intro: (bien) => `You have received a new message about the property <strong>${bien}</strong>:`,
    bouton: "Reply to the message →",
  },
  revision: {
    sujet: (date) => `Your rent is being revised as of ${date}`,
    bandeau: "Rent Revision",
    bonjour: (nom) => `Hello <strong>${nom}</strong>,`,
    intro: (bien, date) => `Your rent for the property <strong>${bien}</strong> is being revised as of <strong>${date}</strong>.`,
    loyerActuel: "Current rent:",
    nouveauLoyer: "New monthly rent",
    base: "Basis of calculation:",
    suite:
      "Rent notices issued from that date will show the new amount. If you have any questions, please reply to your manager.",
    motif: { indice: "index", separateurDecimal: ".", pourcent: "%", deuxPoints: ": " },
  },
  reversement: {
    sujet: (periode) => `Payment of your rents — ${periode}`,
    bandeau: "Payment made",
    bonjour: (nom) => `Hello <strong>${nom}</strong>,`,
    intro: (date, moyen, periode) =>
      `Your agency paid you on ${date} (${moyen}) the following amount, for the management of <strong>${periode}</strong>:`,
    reference: (reference) => `Reference: ${reference}`,
    detail:
      "The details (rent collected, charges, commission) are in your management report, available in your owner portal.",
    moyens: { BANK_TRANSFER: "bank transfer", CASH: "cash", CHEQUE: "cheque", MOBILE_MONEY: "mobile money", OTHER: "other method" },
  },
  garant: {
    sujet: (locataire, periode) => `Notice: unpaid rent of ${locataire} — ${periode}`,
    bonjour: (nom) => `Hello <strong>${nom}</strong>,`,
    corps: (locataire, bien, periode, montant) =>
      `You are the guarantor of the lease of <strong>${locataire}</strong> for the property <strong>${bien}</strong>. We inform you that the rent for <strong>${periode}</strong> remains unpaid despite our reminders, in the amount of <strong>${montant}</strong>.`,
    plafond: (montant) => `As a reminder, the maximum amount you have guaranteed is <strong>${montant}</strong>.`,
    contact: (agence) => `If you have any questions, you can contact ${agence}.`,
  },
  finDeContrat: {
    sujet: (bien, jours) => `Reminder: contract ends in ${jours} days — ${bien}`,
    titre: "Rental contract end reminder",
    intro: (locataire, bien, date, jours) =>
      `The rental contract of <strong>${locataire}</strong> for the property <strong>${bien}</strong> ends on <strong>${date}</strong> (in ${jours} days).`,
    conseil: "Remember to contact the tenant to discuss a renewal, an exit inspection or vacating the property.",
  },
  assurance: {
    sujet: (bien, jours) => `Reminder: insurance policy to renew in ${jours} days — ${bien}`,
    titre: "Insurance expiry reminder",
    intro: (police, assureur, bien, date, jours) =>
      `The insurance policy <strong>${police}</strong> taken out with <strong>${assureur}</strong> for the property <strong>${bien}</strong> expires on <strong>${date}</strong> (in ${jours} days).`,
    conseil: "Remember to contact your insurer to renew the contract or take out a new one before that date.",
  },
  parrainage: {
    sujet: (jours) => `🎁 +${jours} free days — your referral has joined ImmoPlatform Pro`,
    titre: "🎁 Thank you for your referral!",
    intro: (jours) =>
      `The person you referred has just confirmed their account. As a thank-you, <strong>${jours} days</strong> have been added to your access.`,
    nouvelleEcheance: "New expiry date",
    suite: "Keep sharing your referral code to extend your access with every new confirmed referral.",
    bouton: "View my referral program →",
  },
};

const es: TextesSuite = {
  guillemets: ["«", "»"],
  signalement: {
    statuts: { OPEN: "Abierto", IN_PROGRESS: "En tramitación", RESOLVED: "Resuelto", REJECTED: "Rechazado" },
    sujet: (emoji, titre) => `${emoji} Actualización de su incidencia — ${titre}`,
    titre: (emoji) => `${emoji} Actualización de la incidencia que comunicó`,
    bonjour: (nom) => `Hola ${nom},`,
    intro: (titre, bien) => `El estado de su incidencia <strong>«${titre}»</strong> del inmueble <strong>${bien}</strong> se ha actualizado:`,
    intervention: (date) =>
      `<strong>📅 Intervención prevista el ${date}</strong><br/>Le rogamos que esté presente o que facilite el acceso al inmueble.`,
    note: "Mensaje de su agencia:",
    bouton: "Ver mis incidencias →",
  },
  message: {
    sujet: (bien) => `💬 Nuevo mensaje de su agencia — ${bien}`,
    titre: "💬 Nuevo mensaje de su agencia",
    bonjour: (nom) => `Hola ${nom},`,
    intro: (bien) => `Ha recibido un nuevo mensaje sobre el inmueble <strong>${bien}</strong>:`,
    bouton: "Responder al mensaje →",
  },
  revision: {
    sujet: (date) => `Revisión de su alquiler a partir del ${date}`,
    bandeau: "Revisión del alquiler",
    bonjour: (nom) => `Hola <strong>${nom}</strong>,`,
    intro: (bien, date) => `Su alquiler del inmueble <strong>${bien}</strong> se revisa a partir del <strong>${date}</strong>.`,
    loyerActuel: "Alquiler actual:",
    nouveauLoyer: "Nuevo alquiler mensual",
    base: "Base de cálculo:",
    suite:
      "Los avisos de vencimiento emitidos a partir de esa fecha reflejarán el nuevo importe. Si tiene alguna pregunta, responda a su gestor.",
    motif: { indice: "índice", separateurDecimal: ",", pourcent: " %", deuxPoints: ": " },
  },
  reversement: {
    sujet: (periode) => `Liquidación de sus alquileres — ${periode}`,
    bandeau: "Liquidación realizada",
    bonjour: (nom) => `Hola <strong>${nom}</strong>,`,
    intro: (date, moyen, periode) =>
      `Su agencia le abonó el ${date} (${moyen}) la siguiente cantidad, por la gestión de <strong>${periode}</strong>:`,
    reference: (reference) => `Referencia: ${reference}`,
    detail:
      "El detalle (alquileres cobrados, gastos, comisión) figura en su informe de gestión, disponible en su espacio de propietario.",
    moyens: { BANK_TRANSFER: "transferencia", CASH: "efectivo", CHEQUE: "cheque", MOBILE_MONEY: "mobile money", OTHER: "otro medio" },
  },
  garant: {
    sujet: (locataire, periode) => `Aviso: alquiler impagado de ${locataire} — ${periode}`,
    bonjour: (nom) => `Hola <strong>${nom}</strong>,`,
    corps: (locataire, bien, periode, montant) =>
      `Usted es avalista del contrato de <strong>${locataire}</strong> del inmueble <strong>${bien}</strong>. Le informamos de que el alquiler de <strong>${periode}</strong> sigue sin pagarse a pesar de nuestros recordatorios, por un importe de <strong>${montant}</strong>.`,
    plafond: (montant) => `Le recordamos que el importe máximo que usted ha avalado es de <strong>${montant}</strong>.`,
    contact: (agence) => `Para cualquier consulta, puede ponerse en contacto con ${agence}.`,
  },
  finDeContrat: {
    sujet: (bien, jours) => `Recordatorio: el contrato termina en ${jours} días — ${bien}`,
    titre: "Recordatorio de fin de contrato de alquiler",
    intro: (locataire, bien, date, jours) =>
      `El contrato de alquiler de <strong>${locataire}</strong> del inmueble <strong>${bien}</strong> vence el <strong>${date}</strong> (dentro de ${jours} días).`,
    conseil: "Recuerda ponerte en contacto con el inquilino para hablar de una renovación, de un acta de salida o de la entrega del inmueble.",
  },
  assurance: {
    sujet: (bien, jours) => `Recordatorio: póliza de seguro por renovar en ${jours} días — ${bien}`,
    titre: "Recordatorio de vencimiento del seguro",
    intro: (police, assureur, bien, date, jours) =>
      `La póliza de seguro <strong>${police}</strong> contratada con <strong>${assureur}</strong> para el inmueble <strong>${bien}</strong> vence el <strong>${date}</strong> (dentro de ${jours} días).`,
    conseil: "Recuerda ponerte en contacto con tu aseguradora para renovar el contrato o contratar uno nuevo antes de esa fecha.",
  },
  parrainage: {
    sujet: (jours) => `🎁 +${jours} días de regalo — tu referido se ha unido a ImmoPlatform Pro`,
    titre: "🎁 ¡Gracias por recomendarnos!",
    intro: (jours) =>
      `La persona a la que has recomendado acaba de confirmar su cuenta. Como agradecimiento, se han añadido <strong>${jours} días</strong> a tu acceso.`,
    nouvelleEcheance: "Nueva fecha de vencimiento",
    suite: "Sigue compartiendo tu código de recomendación para prolongar tu acceso con cada nuevo referido confirmado.",
    bouton: "Ver mi programa de recomendación →",
  },
};

const pt: TextesSuite = {
  guillemets: ["“", "”"],
  signalement: {
    statuts: { OPEN: "Aberto", IN_PROGRESS: "Em andamento", RESOLVED: "Resolvido", REJECTED: "Rejeitado" },
    sujet: (emoji, titre) => `${emoji} Atualização da sua ocorrência — ${titre}`,
    titre: (emoji) => `${emoji} Atualização da ocorrência que você registrou`,
    bonjour: (nom) => `Olá ${nom},`,
    intro: (titre, bien) => `O status da sua ocorrência <strong>“${titre}”</strong> referente ao imóvel <strong>${bien}</strong> foi atualizado:`,
    intervention: (date) =>
      `<strong>📅 Intervenção prevista para ${date}</strong><br/>Certifique-se de estar presente ou de providenciar o acesso ao imóvel.`,
    note: "Mensagem da sua imobiliária:",
    bouton: "Ver minhas ocorrências →",
  },
  message: {
    sujet: (bien) => `💬 Nova mensagem da sua imobiliária — ${bien}`,
    titre: "💬 Nova mensagem da sua imobiliária",
    bonjour: (nom) => `Olá ${nom},`,
    intro: (bien) => `Você recebeu uma nova mensagem sobre o imóvel <strong>${bien}</strong>:`,
    bouton: "Responder à mensagem →",
  },
  revision: {
    sujet: (date) => `Revisão do seu aluguel a partir de ${date}`,
    bandeau: "Revisão do aluguel",
    bonjour: (nom) => `Olá <strong>${nom}</strong>,`,
    intro: (bien, date) => `O seu aluguel do imóvel <strong>${bien}</strong> será revisto a partir de <strong>${date}</strong>.`,
    loyerActuel: "Aluguel atual:",
    nouveauLoyer: "Novo aluguel mensal",
    base: "Base de cálculo:",
    suite:
      "Os avisos de vencimento emitidos a partir dessa data trarão o novo valor. Em caso de dúvida, responda ao seu gestor.",
    motif: { indice: "índice", separateurDecimal: ",", pourcent: "%", deuxPoints: ": " },
  },
  reversement: {
    sujet: (periode) => `Repasse dos seus aluguéis — ${periode}`,
    bandeau: "Repasse efetuado",
    bonjour: (nom) => `Olá <strong>${nom}</strong>,`,
    intro: (date, moyen, periode) =>
      `A sua imobiliária repassou a você em ${date} (${moyen}) o seguinte valor, referente à gestão de <strong>${periode}</strong>:`,
    reference: (reference) => `Referência: ${reference}`,
    detail:
      "O detalhamento (aluguéis recebidos, despesas, comissão) consta no seu relatório de gestão, disponível no seu espaço do proprietário.",
    moyens: { BANK_TRANSFER: "transferência", CASH: "dinheiro", CHEQUE: "cheque", MOBILE_MONEY: "mobile money", OTHER: "outro meio" },
  },
  garant: {
    sujet: (locataire, periode) => `Informação: aluguel em atraso de ${locataire} — ${periode}`,
    bonjour: (nom) => `Olá <strong>${nom}</strong>,`,
    corps: (locataire, bien, periode, montant) =>
      `Você é fiador do contrato de locação de <strong>${locataire}</strong> referente ao imóvel <strong>${bien}</strong>. Informamos que o aluguel de <strong>${periode}</strong> continua em atraso apesar dos nossos lembretes, no valor de <strong>${montant}</strong>.`,
    plafond: (montant) => `Lembramos que o valor máximo que você garantiu é de <strong>${montant}</strong>.`,
    contact: (agence) => `Em caso de dúvida, você pode entrar em contato com ${agence}.`,
  },
  finDeContrat: {
    sujet: (bien, jours) => `Lembrete: o contrato termina em ${jours} dias — ${bien}`,
    titre: "Lembrete de fim de contrato de locação",
    intro: (locataire, bien, date, jours) =>
      `O contrato de locação de <strong>${locataire}</strong> referente ao imóvel <strong>${bien}</strong> termina em <strong>${date}</strong> (em ${jours} dias).`,
    conseil: "Lembre-se de entrar em contato com o inquilino para conversar sobre uma renovação, uma vistoria de saída ou a desocupação do imóvel.",
  },
  assurance: {
    sujet: (bien, jours) => `Lembrete: apólice de seguro a renovar em ${jours} dias — ${bien}`,
    titre: "Lembrete de vencimento do seguro",
    intro: (police, assureur, bien, date, jours) =>
      `A apólice de seguro <strong>${police}</strong> contratada com <strong>${assureur}</strong> para o imóvel <strong>${bien}</strong> vence em <strong>${date}</strong> (em ${jours} dias).`,
    conseil: "Lembre-se de entrar em contato com a sua seguradora para renovar o contrato ou contratar um novo antes dessa data.",
  },
  parrainage: {
    sujet: (jours) => `🎁 +${jours} dias de presente — a pessoa que você indicou entrou no ImmoPlatform Pro`,
    titre: "🎁 Obrigado pela sua indicação!",
    intro: (jours) =>
      `A pessoa que você indicou acabou de confirmar a conta. Em agradecimento, <strong>${jours} dias</strong> foram adicionados ao seu acesso.`,
    nouvelleEcheance: "Nova data de vencimento",
    suite: "Continue compartilhando o seu código de indicação para prolongar o seu acesso a cada nova indicação confirmada.",
    bouton: "Ver meu programa de indicação →",
  },
};

export const TEXTES_SUITE: Record<Langue, TextesSuite> = { fr, en, es, pt };
