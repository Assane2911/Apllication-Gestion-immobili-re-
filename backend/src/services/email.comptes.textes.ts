import type { Langue } from "../utils/langue";

/**
 * Textes des e-mails de compte (confirmation d'adresse, mot de passe oublié, invitations, bienvenue Google, compte déjà
 * existant), dans les quatre langues de l'interface. La mise en page est dans email.service.ts : ici, seulement les
 * mots. Les fonctions reçoivent des valeurs DÉJÀ échappées pour le HTML (noms d'agence, de personne), sauf quand le
 * commentaire dit que c'est un texte brut (sujets).
 *
 * Le français est le texte d'origine, repris tel quel.
 */
export interface TextesCompte {
  pied: string;
  bonjour: string;
  bonjourNom: (nom: string) => string;
  motDePasseOublie: { sujet: string; titre: string; intro: string; bouton: string; ignorer: string };
  invitationEquipe: {
    /** Texte brut : le nom de la personne puis celui de l'agence. */
    sujet: (personne: string, agence: string) => string;
    titre: string;
    intro: (personne: string, agence: string) => string;
    bouton: string;
    ignorer: string;
    agenceParDefaut: string;
    gestionnaireParDefaut: string;
  };
  invitationProprietaire: {
    sujet: (agence: string) => string;
    titre: string;
    intro: (agence: string) => string;
    bouton: string;
    ignorer: string;
    agenceParDefaut: string;
  };
  confirmationAdresse: { sujet: string; titre: string; intro: string; bouton: string; ignorer: string };
  bienvenueGoogle: {
    sujet: string;
    titre: string;
    intro: (joursEssai: number) => string;
    pourDemarrer: string;
    etapes: [string, string, string];
    bouton: string;
    noteMotDePasse: string;
    noteIgnorer: string;
  };
  compteDejaExistant: {
    sujet: string;
    titre: string;
    intro: string;
    bouton: string;
    /** `lien` est l'adresse de réinitialisation, déjà échappée. */
    motDePasseOublie: (lien: string) => string;
    ignorer: string;
  };
}

const fr: TextesCompte = {
  pied: "Cet email a été envoyé automatiquement par votre application de gestion immobilière.",
  bonjour: "Bonjour,",
  bonjourNom: (nom) => `Bonjour ${nom},`,
  motDePasseOublie: {
    sujet: "🔒 Réinitialisation de votre mot de passe",
    titre: "🔒 Réinitialisation de votre mot de passe",
    intro:
      "Vous avez demandé la réinitialisation du mot de passe de votre compte. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe. Ce lien est valable <strong>1 heure</strong>.",
    bouton: "Réinitialiser mon mot de passe →",
    ignorer:
      "Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email sans risque : votre mot de passe actuel reste inchangé.",
  },
  invitationEquipe: {
    sujet: (personne, agence) => `🔑 ${personne} vous invite à rejoindre ${agence}`,
    titre: "🔑 Invitation à rejoindre l'agence",
    intro: (personne, agence) =>
      `<strong>${personne}</strong> vous invite à rejoindre <strong>${agence}</strong> en tant que collaborateur : vous aurez accès aux mêmes biens, locataires et contrats que le reste de l'agence. Cliquez sur le bouton ci-dessous pour choisir votre mot de passe et activer votre accès. Ce lien est valable <strong>7 jours</strong>.`,
    bouton: "Activer mon accès →",
    ignorer:
      "Si vous ne vous attendiez pas à cette invitation, vous pouvez ignorer cet email sans risque : aucun accès ne sera créé sans confirmation de votre part.",
    agenceParDefaut: "Votre agence",
    gestionnaireParDefaut: "Votre gestionnaire",
  },
  invitationProprietaire: {
    sujet: (agence) => `🔑 ${agence} vous invite à votre espace propriétaire`,
    titre: "🔑 Votre espace propriétaire",
    intro: (agence) =>
      `<strong>${agence}</strong> vous invite à accéder à votre espace propriétaire : vous pourrez y suivre le loyer perçu et en attente pour vos biens. Cliquez sur le bouton ci-dessous pour choisir votre mot de passe et activer votre accès. Ce lien est valable <strong>7 jours</strong>.`,
    bouton: "Activer mon accès →",
    ignorer:
      "Si vous ne vous attendiez pas à cette invitation, vous pouvez ignorer cet email sans risque : aucun accès ne sera créé sans confirmation de votre part.",
    agenceParDefaut: "Votre agence",
  },
  confirmationAdresse: {
    sujet: "✅ Confirmez votre adresse email",
    titre: "✅ Confirmez votre adresse email",
    intro:
      "Merci de votre inscription ! Il ne reste qu'une étape avant de pouvoir vous connecter : confirmez votre adresse email en cliquant sur le bouton ci-dessous. Ce lien est valable <strong>24 heures</strong>.",
    bouton: "Confirmer mon email →",
    ignorer:
      "Si vous n'êtes pas à l'origine de cette inscription, vous pouvez ignorer cet email sans risque : aucun compte ne sera activé sans confirmation.",
  },
  bienvenueGoogle: {
    sujet: "👋 Bienvenue sur ImmoPlatform Pro",
    titre: "👋 Bienvenue sur ImmoPlatform Pro !",
    intro: (n) =>
      `Votre compte vient d'être créé avec votre compte Google : votre adresse est déjà confirmée, vous n'avez rien d'autre à valider. Votre <strong>essai gratuit de ${n} jours</strong> a commencé, avec les fonctionnalités de la formule Professionnel.`,
    pourDemarrer: "Pour bien démarrer :",
    etapes: [
      "Ajoutez votre premier bien immobilier.",
      "Enregistrez votre locataire.",
      "Créez le contrat de bail : les loyers et les quittances se génèrent ensuite automatiquement.",
    ],
    bouton: "Accéder à mon espace →",
    noteMotDePasse:
      "Vous vous connectez avec Google. Si vous souhaitez aussi pouvoir vous connecter avec un mot de passe, utilisez « Mot de passe oublié » sur la page de connexion.",
    noteIgnorer: "Si vous n'êtes pas à l'origine de cette inscription, répondez simplement à ce message ou ignorez-le.",
  },
  compteDejaExistant: {
    sujet: "Vous avez déjà un compte chez nous",
    titre: "Vous avez déjà un compte",
    intro:
      "Une inscription vient d'être tentée avec cette adresse email, mais un compte existe déjà. Pas besoin d'en créer un second : connectez-vous directement.",
    bouton: "Me connecter →",
    motDePasseOublie: (lien) => `Mot de passe oublié ? <a href="${lien}">Réinitialisez-le ici</a>.`,
    ignorer:
      "Si vous n'êtes pas à l'origine de cette tentative, vous pouvez ignorer cet email : votre compte n'a pas été modifié et personne n'y a eu accès.",
  },
};

const en: TextesCompte = {
  pied: "This email was sent automatically by your property management application.",
  bonjour: "Hello,",
  bonjourNom: (nom) => `Hello ${nom},`,
  motDePasseOublie: {
    sujet: "🔒 Reset your password",
    titre: "🔒 Reset your password",
    intro:
      "You requested a password reset for your account. Click the button below to choose a new password. This link is valid for <strong>1 hour</strong>.",
    bouton: "Reset my password →",
    ignorer: "If you did not make this request, you can safely ignore this email: your current password remains unchanged.",
  },
  invitationEquipe: {
    sujet: (personne, agence) => `🔑 ${personne} invites you to join ${agence}`,
    titre: "🔑 Invitation to join the agency",
    intro: (personne, agence) =>
      `<strong>${personne}</strong> invites you to join <strong>${agence}</strong> as a team member: you will have access to the same properties, tenants and contracts as the rest of the agency. Click the button below to choose your password and activate your access. This link is valid for <strong>7 days</strong>.`,
    bouton: "Activate my access →",
    ignorer:
      "If you were not expecting this invitation, you can safely ignore this email: no access will be created without your confirmation.",
    agenceParDefaut: "Your agency",
    gestionnaireParDefaut: "Your manager",
  },
  invitationProprietaire: {
    sujet: (agence) => `🔑 ${agence} invites you to your owner portal`,
    titre: "🔑 Your owner portal",
    intro: (agence) =>
      `<strong>${agence}</strong> invites you to access your owner portal, where you can follow the rent received and pending for your properties. Click the button below to choose your password and activate your access. This link is valid for <strong>7 days</strong>.`,
    bouton: "Activate my access →",
    ignorer:
      "If you were not expecting this invitation, you can safely ignore this email: no access will be created without your confirmation.",
    agenceParDefaut: "Your agency",
  },
  confirmationAdresse: {
    sujet: "✅ Confirm your email address",
    titre: "✅ Confirm your email address",
    intro:
      "Thank you for signing up! One last step before you can log in: confirm your email address by clicking the button below. This link is valid for <strong>24 hours</strong>.",
    bouton: "Confirm my email →",
    ignorer: "If you did not sign up, you can safely ignore this email: no account will be activated without confirmation.",
  },
  bienvenueGoogle: {
    sujet: "👋 Welcome to ImmoPlatform Pro",
    titre: "👋 Welcome to ImmoPlatform Pro!",
    intro: (n) =>
      `Your account has just been created with your Google account: your address is already confirmed, there is nothing else to validate. Your <strong>${n}-day free trial</strong> has started, with the features of the Professional plan.`,
    pourDemarrer: "To get started:",
    etapes: [
      "Add your first property.",
      "Register your tenant.",
      "Create the lease: rents and receipts are then generated automatically.",
    ],
    bouton: "Go to my account →",
    noteMotDePasse:
      "You sign in with Google. If you would also like to be able to sign in with a password, use “Forgot password” on the login page.",
    noteIgnorer: "If you did not sign up, simply reply to this message or ignore it.",
  },
  compteDejaExistant: {
    sujet: "You already have an account with us",
    titre: "You already have an account",
    intro:
      "Someone just tried to sign up with this email address, but an account already exists. There is no need to create a second one: simply log in.",
    bouton: "Log in →",
    motDePasseOublie: (lien) => `Forgot your password? <a href="${lien}">Reset it here</a>.`,
    ignorer:
      "If you did not make this attempt, you can ignore this email: your account has not been modified and nobody has accessed it.",
  },
};

const es: TextesCompte = {
  pied: "Este correo se ha enviado automáticamente desde tu aplicación de gestión inmobiliaria.",
  bonjour: "Hola,",
  bonjourNom: (nom) => `Hola ${nom},`,
  motDePasseOublie: {
    sujet: "🔒 Restablece tu contraseña",
    titre: "🔒 Restablece tu contraseña",
    intro:
      "Has solicitado restablecer la contraseña de tu cuenta. Haz clic en el botón de abajo para elegir una nueva contraseña. Este enlace es válido durante <strong>1 hora</strong>.",
    bouton: "Restablecer mi contraseña →",
    ignorer: "Si no has hecho esta solicitud, puedes ignorar este correo sin riesgo: tu contraseña actual no cambiará.",
  },
  invitationEquipe: {
    sujet: (personne, agence) => `🔑 ${personne} te invita a unirte a ${agence}`,
    titre: "🔑 Invitación para unirte a la agencia",
    intro: (personne, agence) =>
      `<strong>${personne}</strong> te invita a unirte a <strong>${agence}</strong> como colaborador: tendrás acceso a los mismos inmuebles, inquilinos y contratos que el resto de la agencia. Haz clic en el botón de abajo para elegir tu contraseña y activar tu acceso. Este enlace es válido durante <strong>7 días</strong>.`,
    bouton: "Activar mi acceso →",
    ignorer:
      "Si no esperabas esta invitación, puedes ignorar este correo sin riesgo: no se creará ningún acceso sin tu confirmación.",
    agenceParDefaut: "Tu agencia",
    gestionnaireParDefaut: "Tu gestor",
  },
  invitationProprietaire: {
    sujet: (agence) => `🔑 ${agence} te invita a tu espacio de propietario`,
    titre: "🔑 Tu espacio de propietario",
    intro: (agence) =>
      `<strong>${agence}</strong> te invita a acceder a tu espacio de propietario, donde podrás seguir el alquiler cobrado y pendiente de tus inmuebles. Haz clic en el botón de abajo para elegir tu contraseña y activar tu acceso. Este enlace es válido durante <strong>7 días</strong>.`,
    bouton: "Activar mi acceso →",
    ignorer:
      "Si no esperabas esta invitación, puedes ignorar este correo sin riesgo: no se creará ningún acceso sin tu confirmación.",
    agenceParDefaut: "Tu agencia",
  },
  confirmationAdresse: {
    sujet: "✅ Confirma tu correo electrónico",
    titre: "✅ Confirma tu correo electrónico",
    intro:
      "¡Gracias por registrarte! Solo falta un paso para poder iniciar sesión: confirma tu correo electrónico haciendo clic en el botón de abajo. Este enlace es válido durante <strong>24 horas</strong>.",
    bouton: "Confirmar mi correo →",
    ignorer:
      "Si no has sido tú quien se ha registrado, puedes ignorar este correo sin riesgo: no se activará ninguna cuenta sin confirmación.",
  },
  bienvenueGoogle: {
    sujet: "👋 Bienvenido a ImmoPlatform Pro",
    titre: "👋 ¡Bienvenido a ImmoPlatform Pro!",
    intro: (n) =>
      `Tu cuenta se acaba de crear con tu cuenta de Google: tu dirección ya está confirmada y no tienes nada más que validar. Tu <strong>prueba gratuita de ${n} días</strong> ha comenzado, con las funciones del plan Profesional.`,
    pourDemarrer: "Para empezar bien:",
    etapes: [
      "Añade tu primer inmueble.",
      "Registra a tu inquilino.",
      "Crea el contrato de alquiler: los alquileres y los recibos se generan después automáticamente.",
    ],
    bouton: "Ir a mi espacio →",
    noteMotDePasse:
      "Inicias sesión con Google. Si también quieres poder iniciar sesión con una contraseña, usa «¿Olvidaste tu contraseña?» en la página de inicio de sesión.",
    noteIgnorer: "Si no has sido tú quien se ha registrado, responde a este mensaje o ignóralo.",
  },
  compteDejaExistant: {
    sujet: "Ya tienes una cuenta con nosotros",
    titre: "Ya tienes una cuenta",
    intro:
      "Alguien acaba de intentar registrarse con esta dirección de correo, pero ya existe una cuenta. No hace falta crear otra: inicia sesión directamente.",
    bouton: "Iniciar sesión →",
    motDePasseOublie: (lien) => `¿Olvidaste tu contraseña? <a href="${lien}">Restablécela aquí</a>.`,
    ignorer:
      "Si no has sido tú quien lo ha intentado, puedes ignorar este correo: tu cuenta no se ha modificado y nadie ha accedido a ella.",
  },
};

const pt: TextesCompte = {
  pied: "Este e-mail foi enviado automaticamente pelo seu aplicativo de gestão imobiliária.",
  bonjour: "Olá,",
  bonjourNom: (nom) => `Olá ${nom},`,
  motDePasseOublie: {
    sujet: "🔒 Redefina sua senha",
    titre: "🔒 Redefina sua senha",
    intro:
      "Você solicitou a redefinição da senha da sua conta. Clique no botão abaixo para escolher uma nova senha. Este link é válido por <strong>1 hora</strong>.",
    bouton: "Redefinir minha senha →",
    ignorer: "Se você não fez este pedido, pode ignorar este e-mail sem risco: sua senha atual permanece inalterada.",
  },
  invitationEquipe: {
    sujet: (personne, agence) => `🔑 ${personne} convida você para se juntar a ${agence}`,
    titre: "🔑 Convite para ingressar na agência",
    intro: (personne, agence) =>
      `<strong>${personne}</strong> convida você para se juntar a <strong>${agence}</strong> como colaborador: você terá acesso aos mesmos imóveis, inquilinos e contratos que o restante da agência. Clique no botão abaixo para escolher sua senha e ativar seu acesso. Este link é válido por <strong>7 dias</strong>.`,
    bouton: "Ativar meu acesso →",
    ignorer:
      "Se você não esperava este convite, pode ignorar este e-mail sem risco: nenhum acesso será criado sem a sua confirmação.",
    agenceParDefaut: "Sua agência",
    gestionnaireParDefaut: "Seu gestor",
  },
  invitationProprietaire: {
    sujet: (agence) => `🔑 ${agence} convida você para o seu espaço de proprietário`,
    titre: "🔑 Seu espaço de proprietário",
    intro: (agence) =>
      `<strong>${agence}</strong> convida você a acessar o seu espaço de proprietário, onde poderá acompanhar o aluguel recebido e pendente dos seus imóveis. Clique no botão abaixo para escolher sua senha e ativar seu acesso. Este link é válido por <strong>7 dias</strong>.`,
    bouton: "Ativar meu acesso →",
    ignorer:
      "Se você não esperava este convite, pode ignorar este e-mail sem risco: nenhum acesso será criado sem a sua confirmação.",
    agenceParDefaut: "Sua agência",
  },
  confirmationAdresse: {
    sujet: "✅ Confirme seu endereço de e-mail",
    titre: "✅ Confirme seu endereço de e-mail",
    intro:
      "Obrigado por se cadastrar! Falta apenas uma etapa para você poder entrar: confirme seu endereço de e-mail clicando no botão abaixo. Este link é válido por <strong>24 horas</strong>.",
    bouton: "Confirmar meu e-mail →",
    ignorer:
      "Se não foi você quem se cadastrou, pode ignorar este e-mail sem risco: nenhuma conta será ativada sem confirmação.",
  },
  bienvenueGoogle: {
    sujet: "👋 Bem-vindo ao ImmoPlatform Pro",
    titre: "👋 Bem-vindo ao ImmoPlatform Pro!",
    intro: (n) =>
      `Sua conta acabou de ser criada com a sua conta do Google: seu endereço já está confirmado, não há mais nada a validar. Seu <strong>teste gratuito de ${n} dias</strong> começou, com os recursos do plano Profissional.`,
    pourDemarrer: "Para começar bem:",
    etapes: [
      "Adicione seu primeiro imóvel.",
      "Cadastre seu inquilino.",
      "Crie o contrato de locação: os aluguéis e os recibos são gerados depois automaticamente.",
    ],
    bouton: "Acessar meu espaço →",
    noteMotDePasse:
      "Você entra com o Google. Se também quiser poder entrar com uma senha, use «Esqueci minha senha» na página de login.",
    noteIgnorer: "Se não foi você quem se cadastrou, basta responder a esta mensagem ou ignorá-la.",
  },
  compteDejaExistant: {
    sujet: "Você já tem uma conta conosco",
    titre: "Você já tem uma conta",
    intro:
      "Alguém acabou de tentar se cadastrar com este endereço de e-mail, mas já existe uma conta. Não é preciso criar uma segunda: basta entrar.",
    bouton: "Entrar →",
    motDePasseOublie: (lien) => `Esqueceu sua senha? <a href="${lien}">Redefina-a aqui</a>.`,
    ignorer:
      "Se não foi você quem tentou, pode ignorar este e-mail: sua conta não foi modificada e ninguém teve acesso a ela.",
  },
};

export const TEXTES_COMPTE: Record<Langue, TextesCompte> = { fr, en, es, pt };
