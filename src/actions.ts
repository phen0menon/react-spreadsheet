import * as PointSet from "./point-set";
import * as PointMap from "./point-map";
import * as PointRange from "./point-range";
import * as Matrix from "./matrix";
import * as Types from "./types";
import * as Point from "./point";
import * as Selection from "./selection";
import { isActive } from "./util";

export const setData = <Cell extends Types.CellBase>(
  state: Types.StoreState<Cell>,
  data: Matrix.Matrix<Cell>
): Partial<Types.StoreState<Cell>> => {
  const nextActive =
    state.active && Matrix.has(state.active, data) ? state.active : null;
  const nextSelected = Selection.normalize(state.selected, data);
  const nextBindings = PointMap.map(
    (bindings) => PointSet.filter((point) => Matrix.has(point, data), bindings),
    PointMap.filter((_, point) => Matrix.has(point, data), state.bindings)
  );
  return {
    data,
    active: nextActive,
    selected: nextSelected,
    bindings: nextBindings,
  };
};

export const select = (
  state: Types.StoreState,
  cellPointer: Point.Point
): Partial<Types.StoreState> | null => {
  if (state.active && !isActive(state.active, cellPointer)) {
    return {
      selected: PointRange.create(cellPointer, state.active),
      mode: "view",
    };
  }
  return null;
};

export const selectEntireRow = (
  state: Types.StoreState,
  row: number
): Partial<Types.StoreState> => ({
  active:
    state.active && state.active.row === row
      ? state.active
      : {
          row,
          column: 0,
        },
  selected: Selection.createEntireRows(row, row),
  mode: "view",
});

export const selectEntireColumn = (
  state: Types.StoreState,
  column: number
): Partial<Types.StoreState> => ({
  active:
    state.active && state.active.column === column
      ? state.active
      : {
          row: 0,
          column,
        },
  selected: Selection.createEntireColumns(column, column),
  mode: "view",
});

export const selectEntireTable = (
  state: Types.StoreState
): Partial<Types.StoreState> => ({
  active: state.active ? state.active : Point.ORIGIN,
  selected: Selection.createEntireTable(),
});

export const activate = (
  state: Types.StoreState,
  cellPointer: Point.Point
): Partial<Types.StoreState> | null => ({
  selected: PointRange.create(cellPointer, cellPointer),
  active: cellPointer,
  mode: isActive(state.active, cellPointer) ? "edit" : "view",
});

export function setCellData<Cell extends Types.CellBase>(
  state: Types.StoreState<Cell>,
  active: Point.Point,
  cellData: Cell,
  bindings: Point.Point[]
): Partial<Types.StoreState<Cell>> | null {
  if (isActiveReadOnly(state)) {
    return null;
  }
  return {
    mode: "edit",
    data: Matrix.set(active, cellData, state.data),
    lastChanged: active,
    bindings: PointMap.set(active, PointSet.from(bindings), state.bindings),
  };
}

export function setCellDimensions(
  state: Types.StoreState,
  point: Point.Point,
  dimensions: Types.Dimensions
): Partial<Types.StoreState> | null {
  const prevRowDimensions = state.rowDimensions[point.row];
  const prevColumnDimensions = state.columnDimensions[point.column];
  if (
    prevRowDimensions &&
    prevColumnDimensions &&
    prevRowDimensions.top === dimensions.top &&
    prevRowDimensions.height === dimensions.height &&
    prevColumnDimensions.left === dimensions.left &&
    prevColumnDimensions.width === dimensions.width
  ) {
    return null;
  }
  return {
    rowDimensions: {
      ...state.rowDimensions,
      [point.row]: { top: dimensions.top, height: dimensions.height },
    },
    columnDimensions: {
      ...state.columnDimensions,
      [point.column]: { left: dimensions.left, width: dimensions.width },
    },
  };
}

export function copy<Cell extends Types.CellBase>(
  state: Types.StoreState<Cell>
): Partial<Types.StoreState<Cell>> {
  const selectedPoints = Selection.getPoints(state.selected, state.data);
  return {
    copied: selectedPoints.reduce((acc, point) => {
      const value = Matrix.get(point, state.data);
      return value === undefined ? acc : PointMap.set(point, value, acc);
    }, PointMap.from<Cell>([])),
    cut: false,
    hasPasted: false,
  };
}

export function cut(state: Types.StoreState): Partial<Types.StoreState> {
  return {
    ...copy(state),
    cut: true,
  };
}

export async function paste<Cell extends Types.CellBase>(
  state: Types.StoreState<Cell>,
  text: string
): Promise<Partial<Types.StoreState<Cell>> | null> {
  const { active } = state;
  if (!active) {
    return null;
  }
  const copiedMatrix = Matrix.split(text, (value) => ({ value }));
  const copied = PointMap.fromMatrix<any>(copiedMatrix);

  const minPoint = PointSet.min(copied);

  type Accumulator = {
    data: typeof state.data;
    commit: typeof state.lastCommit;
  };

  const copiedSize = Matrix.getSize(copiedMatrix);
  const requiredRows = active.row + copiedSize.rows;
  const paddedData = Matrix.padRows(state.data, requiredRows);

  const { data, commit } = PointMap.reduce(
    (acc: Accumulator, value, point): Accumulator => {
      let commit = acc.commit || [];
      const nextPoint: Point.Point = {
        row: point.row - minPoint.row + active.row,
        column: point.column - minPoint.column + active.column,
      };

      const nextData = state.cut ? Matrix.unset(point, acc.data) : acc.data;

      if (state.cut) {
        commit = [...commit, { prevCell: value, nextCell: null }];
      }

      if (!Matrix.has(nextPoint, paddedData)) {
        return { data: nextData, commit };
      }

      const currentValue = Matrix.get(nextPoint, nextData) || null;

      commit = [
        ...commit,
        {
          prevCell: currentValue,
          nextCell: value,
        },
      ];

      return {
        data: Matrix.set(nextPoint, { ...currentValue, ...value }, nextData),
        commit,
      };
    },
    copied,
    { data: paddedData, commit: [] }
  );
  return {
    data,
    selected: PointRange.create(active, {
      row: active.row + copiedSize.rows - 1,
      column: active.column + copiedSize.columns - 1,
    }),
    cut: false,
    hasPasted: true,
    mode: "view",
    lastCommit: commit,
  };
}

export const edit = (
  state: Types.StoreState<Types.CellBase>
): Partial<Types.StoreState> | null => {
  if (isActiveReadOnly(state)) {
    return null;
  }
  return { mode: "edit" };
};

export const view = (): Partial<Types.StoreState> => ({
  mode: "view",
});

export const clear = <Cell extends Types.CellBase>(
  state: Types.StoreState<Cell>
): Partial<Types.StoreState<Cell>> | null => {
  if (!state.active) {
    return null;
  }
  const selectedPoints = Selection.getPoints(state.selected, state.data);
  const changes = selectedPoints.map((point) => {
    const cell = Matrix.get(point, state.data);
    return {
      prevCell: cell || null,
      nextCell: null,
    };
  });
  return {
    data: selectedPoints.reduce(
      (acc, point) => Matrix.set(point, undefined, acc),
      state.data
    ),
    ...commit(state, changes),
  };
};

export type KeyDownHandler = (
  state: Types.StoreState<Types.CellBase>,
  event: React.KeyboardEvent
) => Partial<Types.StoreState> | null;

export const go =
  (rowDelta: number, columnDelta: number): KeyDownHandler =>
  (state) => {
    if (!state.active) {
      return null;
    }
    const nextActive = {
      row: state.active.row + rowDelta,
      column: state.active.column + columnDelta,
    };
    if (!Matrix.has(nextActive, state.data)) {
      return { mode: "view" };
    }
    return {
      active: nextActive,
      selected: PointRange.create(nextActive, nextActive),
      mode: "view",
    };
  };

export const blur = (): Partial<Types.StoreState> => ({
  active: null,
});

// Key Bindings

type KeyDownHandlers = {
  [K in string]: KeyDownHandler;
};

const keyDownHandlers: KeyDownHandlers = {
  ArrowUp: go(-1, 0),
  ArrowDown: go(+1, 0),
  ArrowLeft: go(0, -1),
  ArrowRight: go(0, +1),
  Tab: go(0, +1),
  Enter: edit,
  Backspace: clear,
  Escape: blur,
};

const editKeyDownHandlers: KeyDownHandlers = {
  Escape: view,
  Tab: keyDownHandlers.Tab,
  Enter: keyDownHandlers.ArrowDown,
};

const editShiftKeyDownHandlers: KeyDownHandlers = {
  Tab: go(0, -1),
};

const shiftKeyDownHandlers: KeyDownHandlers = {
  ArrowUp: (state) => ({
    selected: Selection.modifyEdge(
      state.selected,
      state.active,
      state.data,
      Selection.Direction.Top
    ),
  }),
  ArrowDown: (state) => ({
    selected: Selection.modifyEdge(
      state.selected,
      state.active,
      state.data,
      Selection.Direction.Bottom
    ),
  }),
  ArrowLeft: (state) => ({
    selected: Selection.modifyEdge(
      state.selected,
      state.active,
      state.data,
      Selection.Direction.Left
    ),
  }),
  ArrowRight: (state) => ({
    selected: Selection.modifyEdge(
      state.selected,
      state.active,
      state.data,
      Selection.Direction.Right
    ),
  }),
  Tab: go(0, -1),
};

const shiftMetaKeyDownHandlers: KeyDownHandlers = {};
const metaKeyDownHandlers: KeyDownHandlers = {};

function getActive<Cell extends Types.CellBase>(
  state: Types.StoreState<Cell>
): Cell | null {
  const activeCell = state.active && Matrix.get(state.active, state.data);
  return activeCell || null;
}

const isActiveReadOnly = (state: Types.StoreState<Types.CellBase>): boolean => {
  const activeCell = getActive(state);
  return Boolean(activeCell && activeCell.readOnly);
};

export function keyPress(
  state: Types.StoreState<Types.CellBase>,
  event: React.KeyboardEvent
): Partial<Types.StoreState> | null {
  if (isActiveReadOnly(state) || event.metaKey) {
    return null;
  }
  if (state.mode === "view" && state.active) {
    return { mode: "edit" };
  }
  return null;
}

export function getKeyDownHandler(
  state: Types.StoreState,
  event: React.KeyboardEvent
): KeyDownHandler {
  const { key } = event;
  let handlers;
  // Order matters
  if (state.mode === "edit") {
    if (event.shiftKey) {
      handlers = editShiftKeyDownHandlers;
    } else {
      handlers = editKeyDownHandlers;
    }
  } else if (event.shiftKey && event.metaKey) {
    handlers = shiftMetaKeyDownHandlers;
  } else if (event.shiftKey) {
    handlers = shiftKeyDownHandlers;
  } else if (event.metaKey) {
    handlers = metaKeyDownHandlers;
  } else {
    handlers = keyDownHandlers;
  }

  return handlers[key];
}

export function keyDown(
  state: Types.StoreState,
  event: React.KeyboardEvent
): Partial<Types.StoreState> | null {
  const handler = getKeyDownHandler(state, event);
  if (handler) {
    return handler(state, event);
  }
  return null;
}

export function dragStart(state: Types.StoreState): Partial<Types.StoreState> {
  return { dragging: true };
}

export function dragEnd(state: Types.StoreState): Partial<Types.StoreState> {
  return { dragging: false };
}

export function commit<Cell extends Types.CellBase>(
  state: Types.StoreState<Cell>,
  changes: Array<{
    prevCell: Cell | null;
    nextCell: Cell | null;
  }>
): Partial<Types.StoreState<Cell>> {
  return { lastCommit: changes };
}
