declare module '@exuanbo/file-icons-js' {
  interface FileIcons {
    getClass(filename: string): Promise<string>;
    getClassSync(filename: string): string;
  }

  const icons: FileIcons;
  export default icons;
}
