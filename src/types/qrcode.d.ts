declare module "qrcode" {
  type QRCodeOptions = {
    margin?: number;
    width?: number;
  };

  const QRCode: {
    toDataURL(text: string, options?: QRCodeOptions): Promise<string>;
  };

  export default QRCode;
}
