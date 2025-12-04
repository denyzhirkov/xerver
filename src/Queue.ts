class Node<T> {
  value: T;
  next?: Node<T>;

  constructor(value: T) {
    this.value = value;
  }
}

export class Queue<T> {
  private head?: Node<T>;
  private tail?: Node<T>;
  private _size: number = 0;

  enqueue(value: T): void {
    const node = new Node(value);
    if (this.head) {
      this.tail!.next = node;
      this.tail = node;
    } else {
      this.head = node;
      this.tail = node;
    }
    this._size++;
  }

  dequeue(): T | undefined {
    const current = this.head;
    if (!current) {
      return undefined;
    }
    this.head = current.next;
    this._size--;
    return current.value;
  }

  get size(): number {
    return this._size;
  }

  *[Symbol.iterator](): IterableIterator<T> {
    let current = this.head;
    while (current) {
      yield current.value;
      current = current.next;
    }
  }
}
