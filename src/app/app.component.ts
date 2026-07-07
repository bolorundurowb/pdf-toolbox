import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NAV_ITEMS } from './core/nav.config';
import { PdfService } from './core/pdf.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
})
export class AppComponent {
  readonly nav = NAV_ITEMS;

  constructor(private readonly pdf: PdfService) {}

  async openFile(): Promise<void> {
    // Convenience: open any PDF/image in the OS default viewer.
    const picked = await this.pdf.pickAny();
    if (picked) await this.pdf.openFolderOf(picked);
  }
}
