declare module "nodemailer" {
  type TransportOptions = {
    host: string;
    port: number;
    secure: boolean;
    ignoreTLS?: boolean;
  };

  type SendMailOptions = {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  };

  const nodemailer: {
    createTransport(options: TransportOptions): {
      sendMail(options: SendMailOptions): Promise<void>;
    };
  };

  export default nodemailer;
}
