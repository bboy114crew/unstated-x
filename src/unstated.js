// @flow
import createReactContext from 'create-react-context';
import React, { type Node } from 'react';

type Listener = () => mixed;

export const StateContext = createReactContext(null);

export class Container<State: {}> {
  state: State;
  _listeners: Array<Listener> = [];

  constructor(state?: object) {
    // eslint-disable-next-line no-unused-expressions
    state && (this.state = state);
  }

  setStateSync(state: $Shape<State>) {
    this.state = Object.assign({}, this.state, state);
    this._listeners.forEach(fn => fn(state));
  }

  setState(
    updater: $Shape<State> | ((prevState: $Shape<State>) => $Shape<State>),
    callback?: () => void
  ): Promise<void> {
    return Promise.resolve().then(() => {
      let nextState;

      if (typeof updater === 'function') {
        nextState = updater(this.state);
      } else {
        nextState = updater;
      }

      if (nextState == null) {
        if (callback) callback();
        return;
      }

      this.state = Object.assign({}, this.state, nextState);

      let promises = this._listeners.map(listener => listener(nextState));

      return Promise.all(promises).then(() => {
        if (callback) {
          return callback();
        }
      });
    });
  }

  subscribe(fn: Listener) {
    this._listeners.push(fn);
  }

  unsubscribe(fn: Listener) {
    this._listeners = this._listeners.filter(f => f !== fn);
  }
}

export type ContainerType = Container<Object>;
export type ContainersType = Array<Class<ContainerType> | ContainerType>;
export type ContainerMapType = Map<Class<ContainerType>, ContainerType>;

export type SubscribeProps<Containers: ContainersType> = {
  to: Containers,
  children: (
    ...instances: $TupleMap<Containers, <C>(Class<C> | C) => C>
  ) => Node
};

type SubscribeState = {};

const DUMMY_STATE = {};

export class Subscribe<Containers: ContainersType> extends React.Component<
  SubscribeProps<Containers>,
  SubscribeState
> {
  state = {};
  instances: Array<ContainerType> = [];
  unmounted = false;

  componentWillUnmount() {
    this.unmounted = true;
    this._unsubscribe();
  }

  _unsubscribe() {
    this.instances.forEach(container => {
      container.unsubscribe(this.onUpdate);
    });
  }

  onUpdate: Listener = () => {
    return new Promise(resolve => {
      if (!this.unmounted) {
        this.setState(DUMMY_STATE, resolve);
      } else {
        resolve();
      }
    });
  };

  _createInstances(
    map: ContainerMapType | null,
    containers: ContainersType
  ): Array<ContainerType> {
    this._unsubscribe();

    if (map === null) {
      throw new Error(
        'You must wrap your <Subscribe> components with a <Provider>'
      );
    }

    let safeMap = map;
    let instances = containers.map(ContainerItem => {
      let instance;

      if (
        typeof ContainerItem === 'object' &&
        ContainerItem instanceof Container
      ) {
        instance = ContainerItem;
      } else {
        instance = safeMap.get(ContainerItem);

        if (!instance) {
          instance = new ContainerItem();
          safeMap.set(ContainerItem, instance);
        }
      }

      instance.unsubscribe(this.onUpdate);
      instance.subscribe(this.onUpdate);

      return instance;
    });

    this.instances = instances;
    return instances;
  }

  render() {
    return (
      <StateContext.Consumer>
        {map =>
          Reflect.apply(
            this.props.children,
            null,
            this._createInstances(map, this.props.to)
          )
        }
      </StateContext.Consumer>
    );
  }
}

export class SubscribeOne extends React.Component {
  state = {};
  instance = null;
  unmounted = false;

  componentWillUnmount() {
    this.unmounted = true;
    this._unsubscribe();
  }

  _unsubscribe() {
    this.instance && this.instance.unsubscribe(this.onUpdate);
  }

  onUpdate: Listener = changedState => {
    return new Promise(resolve => {
      if (
        !this.unmounted &&
        Array.isArray(this.props.bind) &&
        Object.keys(changedState).filter(key => this.props.bind.includes(key))
          .length > 0
      ) {
        this.setState(DUMMY_STATE, resolve);
      } else {
        resolve();
      }
    });
  };

  _createInstance(map, container) {
    this._unsubscribe();
    if (map === null) {
      throw new Error(
        'You must wrap your <Subscribe> components with a <Provider>'
      );
    }
    let safeMap = map;
    if (typeof container === 'object' && container instanceof Container) {
      this.instance = container;
    } else {
      this.instance = safeMap.get(container);

      if (!this.instance) {
        this.instance = new container();
        safeMap.set(container, this.instance);
      }
    }

    this.instance.unsubscribe(this.onUpdate);
    this.instance.subscribe(this.onUpdate);

    return this.instance;
  }

  render() {
    return (
      <StateContext.Consumer>
        {map => this.props.children(this._createInstance(map, this.props.to))}
      </StateContext.Consumer>
    );
  }
}

export type ProviderProps = {
  inject?: Array<ContainerType>,
  children: Node
};

export function Provider(props: ProviderProps) {
  const childMap = new Map();
  if (props.inject) {
    props.inject.forEach(instance => {
      childMap.set(instance.constructor, instance);
    });
  }
  return (
    <StateContext.Provider value={childMap}>
      {props.children}
    </StateContext.Provider>
  );
}