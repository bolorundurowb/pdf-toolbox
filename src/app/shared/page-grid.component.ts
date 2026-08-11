import { Component, input, output } from '@angular/core';
import { PageThumbComponent } from './page-thumb.component';
import { ReorderEvent, ReorderItemDirective } from './reorder.directive';

/** One page as shown in the grid. */
export interface PageTile {
  /** Stable identity for `@for` tracking; survives reordering. */
  key: number;
  /** 1-based page number in the source document. */
  source: number;
  /** UI rotation in degrees (0/90/180/270). */
  rotate: number;
  /** Only meaningful in `select` mode. */
  selected: boolean;
}

export type PageGridMode = 'edit' | 'select';

/**
 * The shared page grid behind both Organise and Extract.
 *
 * `edit` mode reorders, rotates, duplicates and removes pages; `select` mode
 * picks a subset. Both show real rendered thumbnails rather than placeholders.
 */
@Component({
  selector: 'app-page-grid',
  imports: [PageThumbComponent, ReorderItemDirective],
  templateUrl: './page-grid.component.html',
})
export class PageGridComponent {
  readonly path = input.required<string>();
  readonly pages = input.required<PageTile[]>();
  readonly mode = input<PageGridMode>('edit');
  /** Kept in sync with the CSS grid so keyboard up/down move by a full row. */
  readonly columns = input(6);

  readonly reorder = output<ReorderEvent>();
  readonly rotate = output<number>();
  readonly remove = output<number>();
  readonly duplicate = output<number>();
  readonly toggle = output<number>();

  protected onTileClick(index: number): void {
    if (this.mode() === 'select') this.toggle.emit(index);
  }

  protected onTileKey(event: KeyboardEvent, index: number): void {
    if (this.mode() !== 'select') return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.toggle.emit(index);
  }
}
