import {ImapFlow as Imap} from 'imapflow';
import {createTransport as Smtp} from 'nodemailer';
import {simpleParser as toMail} from 'mailparser';
import {get} from '@dotenvx/dotenvx';

new Promise(async () => {
   const exitEvents = [
      'SIGINT',
      'SIGTERM',
      'SIGHUP',
      'SIGBREAK',
      'exit',
   ];

   console.error('starting...');
   exitEvents.forEach((v) =>
      process.on(v, async () => {
         console.error('exiting...');
      }),
   );

   const imap = new Imap({
      host: get('IMAP_HOST', {envKeysFile: get('DOTENV')}),
      port: get('IMAP_PORT', {envKeysFile: get('DOTENV')}),
      auth: {
         user: get('USER', {envKeysFile: get('DOTENV')}),
         pass: get('PSWD', {envKeysFile: get('DOTENV')}),
      },
      secure: true,
      logger: false,
   });
   await imap.connect();
   exitEvents.forEach((v) =>
      process.on(v, async () => {
         await imap.logout();
         imap.close();
      }),
   );

   const smtp = Smtp({
      host: get('SMTP_HOST', {envKeysFile: get('DOTENV')}),
      port: get('SMTP_PORT', {envKeysFile: get('DOTENV')}),
      auth: {
         user: get('USER', {envKeysFile: get('DOTENV')}),
         pass: get('PSWD', {envKeysFile: get('DOTENV')}),
      },
      secure: false,
      requireTLS: true,
      logger: false,
   });
   exitEvents.forEach((v) =>
      process.on(v, async () => {
         smtp.close();
      }),
   );

   while (true) {
      console.error('reclaiming, if any...');
      const junkLock = await imap.getMailboxLock(
         get('SPAM', {envKeysFile: get('DOTENV')}),
      );
      await imap.messageMove(
         '1:*',
         get('MAILBOX', {envKeysFile: get('DOTENV')}),
      );
      junkLock.release();

      console.error('checking...');
      const fetchLock = await imap.getMailboxLock(
         get('MAILBOX', {envKeysFile: get('DOTENV')}),
      );
      const emails = await Promise.all(
         (await imap.fetchAll({seen: false}, {source: true})).map((v) =>
            toMail(v.source),
         ),
      );
      fetchLock.release();

      console.error('sending, if any...');
      await Promise.all(
         [
            emails
               .filter(
                  (v) =>
                     v.from?.value.reduce((p, c) => (p ? p : c.address), '') !==
                     get('RCPT', {envKeysFile: get('DOTENV')}),
               )
               .map((v) =>
                  smtp.sendMail({
                     envelope: {
                        from: get('USER', {envKeysFile: get('DOTENV')}),
                        to: get('RCPT', {envKeysFile: get('DOTENV')}),
                     },
                     from: v.from?.value.reduce(
                        (p, c) =>
                           p
                              ? p
                              : `"${c.name || c.address} #${Buffer.from(c.address).toString('base64')}#" <${c.address?.replace(/@/gu, '_at_').replace(/\./gu, '_')}@${get('USER', {envKeysFile: get('DOTENV')}).replace(/.*?@/gu, '')}>`,
                        '',
                     ),
                     to: [
                        v.to,
                     ]
                        .flat()
                        .filter((v) => v)
                        .map((v) => v.text)
                        .join(';'),
                     cc: [
                        v.cc,
                     ]
                        .flat()
                        .filter((v) => v)
                        .map((v) => v.text)
                        .join(';'),
                     bcc: [
                        v.bcc,
                     ]
                        .flat()
                        .filter((v) => v)
                        .map((v) => v.text)
                        .join(';'),
                     replyTo: get('USER', {envKeysFile: get('DOTENV')}),
                     subject: v.subject,
                     date: v.date,
                     text: v.text,
                     html: v.html || v.textAsHtml,
                     attachments: v.attachments.map((v) => ({
                        content: v.content,
                        filename: v.filename,
                        cid: v.cid,
                        contentType: v.contentType,
                        contentDisposition: v.contentDisposition,
                        headers: v.headers,
                     })),
                     priority: v.priority,
                  }),
               ),
            emails
               .filter(
                  (v) =>
                     v.from?.value.reduce((p, c) => (p ? p : c.address), '') ===
                     get('RCPT', {envKeysFile: get('DOTENV')}),
               )
               .map((v) => ({
                  ...v,
                  subject: v.subject.replace(/^#.+#/gu, ''),
                  to: ((address) =>
                     address.includes('@')
                        ? address
                        : Buffer.from(address, 'base64').toString())(
                     v.subject.replace(/^#(.+)#.*$/gu, '$1'),
                  ),
               }))
               .map((v) =>
                  smtp.sendMail({
                     from: get('USER', {envKeysFile: get('DOTENV')}),
                     to: v.to,
                     subject: v.subject,
                     date: v.date,
                     text: v.text,
                     html: v.html || v.textAsHtml,
                     attachments: v.attachments.map((v) => ({
                        content: v.content,
                        filename: v.filename,
                        cid: v.cid,
                        contentType: v.contentType,
                        contentDisposition: v.contentDisposition,
                        headers: v.headers,
                     })),
                     priority: v.priority,
                  }),
               ),
         ].flat(),
      );

      console.error('tagging, if any...');
      const seenLock = await imap.getMailboxLock(
         get('MAILBOX', {envKeysFile: get('DOTENV')}),
      );
      await Promise.all(
         emails.map((v) =>
            imap.messageFlagsAdd(
               {header: {received: v.headers.get('received')[0]}},
               '\\Seen',
            ),
         ),
      );
      seenLock.release();

      await new Promise((res) => setTimeout(res, Math.random() * 10000));
   }
});
