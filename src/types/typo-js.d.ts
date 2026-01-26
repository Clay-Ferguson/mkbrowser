declare module 'typo-js' {
  class Typo {
    constructor(
      dictionary?: string,
      affData?: string | null,
      dicData?: string | null,
      options?: {
        dictionaryPath?: string;
        asyncLoad?: boolean;
        loadedCallback?: (err: Error | null, typo: Typo) => void;
      }
    );

    /**
     * Check if a word is spelled correctly
     */
    check(word: string): boolean;

    /**
     * Get spelling suggestions for a word
     * @param word The misspelled word
     * @param limit Maximum number of suggestions to return
     */
    suggest(word: string, limit?: number): string[];

    /**
     * The dictionary name
     */
    dictionary: string;
  }

  export = Typo;
}
