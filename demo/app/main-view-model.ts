import { Observable } from 'tns-core-modules/data/observable';
import { MtmobileSqlite } from 'nativescript-mtmobile-sqlite';

export class HelloWorldModel extends Observable {
  public message: string;
  private mtmobileSqlite: MtmobileSqlite;

  constructor() {
    super();

    this.mtmobileSqlite = new MtmobileSqlite();
    this.message = this.mtmobileSqlite.message;
  }
}
