#!/usr/bin/env node
/**
 * Faux serveur SMTP local pour mesurer le débit d'envoi des e-mails sous charge : il accepte tout, sans rien livrer,
 * après un délai fixe par message (DELAI_MS, 500 par défaut : ordre de grandeur d'un envoi réel avec connexion et TLS).
 * Écoute sur SINK_PORT (2525 par défaut) et écrit le nombre de messages reçus dans le fichier SINK_COMPTE s'il est fourni.
 */
const net = require("net");
const fs = require("fs");
const DELAI = Number(process.env.DELAI_MS ?? 500);
const PORT = Number(process.env.SINK_PORT ?? 2525);
let recus = 0;
net
  .createServer((sock) => {
    let tampon = "";
    let enDonnees = false;
    sock.write("220 sink ESMTP\r\n");
    sock.on("data", (morceau) => {
      tampon += morceau.toString("latin1");
      if (enDonnees) {
        if (tampon.includes("\r\n.\r\n")) {
          enDonnees = false;
          tampon = "";
          setTimeout(() => {
            recus++;
            if (process.env.SINK_COMPTE) fs.writeFileSync(process.env.SINK_COMPTE, String(recus));
            sock.write("250 2.0.0 queued\r\n");
          }, DELAI);
        }
        return;
      }
      let i;
      while ((i = tampon.indexOf("\r\n")) > -1) {
        const ligne = tampon.slice(0, i).toUpperCase();
        tampon = tampon.slice(i + 2);
        if (ligne.startsWith("EHLO") || ligne.startsWith("HELO")) sock.write("250-sink\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n");
        else if (ligne.startsWith("AUTH")) sock.write("235 2.7.0 ok\r\n");
        else if (ligne.startsWith("MAIL") || ligne.startsWith("RCPT") || ligne.startsWith("RSET")) sock.write("250 ok\r\n");
        else if (ligne === "DATA") {
          sock.write("354 go\r\n");
          enDonnees = true;
          if (tampon.includes("\r\n.\r\n")) sock.emit("data", Buffer.alloc(0));
        } else if (ligne === "QUIT") sock.end("221 bye\r\n");
        else sock.write("250 ok\r\n");
      }
    });
    sock.on("error", () => {});
  })
  .listen(PORT, "127.0.0.1", () => console.log(`sink SMTP sur ${PORT}, délai ${DELAI} ms`));
