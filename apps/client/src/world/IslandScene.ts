import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  terrainHeight,
  visionRange,
  VISION_FIELD_OF_VIEW,
  type WorldDefinition,
  type WorldStateDto,
} from "../../../../packages/shared/src/index.js";

export class IslandScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.5, 2500);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private world = new THREE.Group();
  private readonly agents = new Map<
    string,
    {
      group: THREE.Group;
      target: THREE.Vector3;
      previous: THREE.Vector3;
      receivedAt: number;
    }
  >();
  private readonly entities = new Map<string, THREE.Group>();
  private selectedAgent = "alpha";
  private following = false;
  private definition?: WorldDefinition;
  private readonly sight = new THREE.Group();
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x1c4148);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "3D eiland met verkenners",
    );
    this.host.append(this.renderer.domElement);
    this.scene.fog = new THREE.Fog(0x1c4148, 650, 1300);
    this.scene.add(new THREE.HemisphereLight(0xdaf4ed, 0x59664c, 2.5));
    const sun = new THREE.DirectionalLight(0xffe4b9, 3);
    sun.position.set(-180, 280, 130);
    this.scene.add(sun);
    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(2200, 2200),
      new THREE.MeshStandardMaterial({
        color: 0x235563,
        roughness: 0.48,
        metalness: 0.2,
      }),
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = 0;
    this.scene.add(ocean);
    this.scene.add(this.world);
    this.scene.add(this.sight);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.06;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 850;
    this.resetCamera();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      for (const agent of this.agents.values())
        agent.group.position.lerpVectors(
          agent.previous,
          agent.target,
          Math.min(1, (performance.now() - agent.receivedAt) / 100),
        );
      if (this.following) {
        const agent = this.agents.get(this.selectedAgent);
        if (agent) {
          this.camera.position.add(
            agent.group.position.clone().sub(this.controls.target),
          );
          this.controls.target.copy(agent.group.position);
        }
      }
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }
  private resize() {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
  resetCamera() {
    this.following = false;
    this.camera.position.set(310, 320, 350);
    this.controls.target.set(0, 5, 0);
    this.controls.update();
  }
  focusAgent(id = "alpha") {
    this.selectedAgent = id;
    this.following = true;
    const agent = this.agents.get(id);
    if (!agent) return;
    this.controls.target.copy(agent.target);
    this.camera.position.copy(agent.target).add(new THREE.Vector3(18, 23, 25));
    this.controls.update();
  }
  private createAgent(id: string) {
    const group = new THREE.Group();
    const color =
      id === "alpha" ? 0xffb35d : id === "beta" ? 0x8cc6ff : 0xd2a4fa;
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(1.1, 2.5, 4, 8),
      new THREE.MeshStandardMaterial({ color, roughness: 0.65 }),
    );
    body.position.y = 2.3;
    group.add(body);
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 1.5, 3),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 3, 1.3);
    group.add(nose);
    this.scene.add(group);
    const agent = {
      group,
      target: new THREE.Vector3(),
      previous: new THREE.Vector3(),
      receivedAt: 0,
    };
    this.agents.set(id, agent);
    return agent;
  }
  load(definition: WorldDefinition) {
    this.definition = definition;
    this.clearSight();
    this.disposeGroup(this.world);
    this.scene.remove(this.world);
    this.entities.clear();
    for (const agent of this.agents.values()) {
      this.disposeGroup(agent.group);
      this.scene.remove(agent.group);
    }
    this.agents.clear();
    this.world = new THREE.Group();
    this.scene.add(this.world);
    const { width, depth, resolution: n, heights } = definition.terrain;
    const geometry = new THREE.PlaneGeometry(width, depth, n - 1, n - 1);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position!;
    const colors: number[] = [];
    for (let i = 0; i < positions.count; i++) {
      const h = heights[i]!;
      positions.setY(i, h);
      const color = new THREE.Color(
        h < 1.5 ? 0xd2c190 : h < 8 ? 0x8caa68 : h < 17 ? 0x638356 : 0x7a8566,
      );
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    this.world.add(
      new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 1,
          flatShading: true,
        }),
      ),
    );
    for (const entity of definition.entities) {
      const group = new THREE.Group();
      if (entity.type === "tree") {
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.55, 0.9, 5, 5),
          new THREE.MeshStandardMaterial({ color: 0x73553a }),
        );
        trunk.position.y = 2.5;
        group.add(trunk);
        const crown = new THREE.Mesh(
          new THREE.ConeGeometry(4, 11, 6),
          new THREE.MeshStandardMaterial({
            color: 0x315e44,
            flatShading: true,
          }),
        );
        crown.position.y = 8;
        group.add(crown);
      } else if (entity.type === "rock" || entity.type === "cave") {
        const cave = entity.type === "cave";
        const rock = new THREE.Mesh(
          new THREE.DodecahedronGeometry(cave ? 8 : 2.3, 0),
          new THREE.MeshStandardMaterial({
            color: cave ? 0x525e5b : 0x93988a,
            flatShading: true,
          }),
        );
        rock.scale.set(1.25, 0.8, 1);
        rock.position.y = cave ? 3 : 1;
        group.add(rock);
        if (cave) {
          const opening = new THREE.Mesh(
            new THREE.SphereGeometry(3.3, 12, 8),
            new THREE.MeshStandardMaterial({ color: 0x172a2b }),
          );
          opening.position.set(0, 1.5, 5.5);
          group.add(opening);
        }
      } else if (entity.type === "item") {
        group.add(
          new THREE.Mesh(
            new THREE.DodecahedronGeometry(0.55, 0),
            new THREE.MeshStandardMaterial({
              color:
                entity.itemKind === "fiber"
                  ? 0x809e55
                  : entity.itemKind === "stone" || entity.itemKind === "flint"
                    ? 0x92978f
                    : entity.itemKind === "resin"
                      ? 0xdaa34d
                      : 0x9d7048,
              flatShading: true,
            }),
          ),
        );
      } else {
        const artifact = new THREE.Mesh(
          entity.kind === "shell"
            ? new THREE.SphereGeometry(2, 12, 6)
            : entity.kind === "relic"
              ? new THREE.BoxGeometry(2.7, 2.7, 2.7)
              : new THREE.OctahedronGeometry(2.7),
          new THREE.MeshStandardMaterial({
            color:
              entity.kind === "shell"
                ? 0xffcf61
                : entity.kind === "relic"
                  ? 0xff8c69
                  : 0x77ddcc,
            emissive: 0x2c776e,
            emissiveIntensity: 0.6,
          }),
        );
        if (entity.kind === "shell") artifact.scale.set(1.4, 0.45, 1);
        artifact.position.y = 3;
        group.add(artifact);
      }
      group.position.set(
        entity.position.x,
        entity.position.y,
        entity.position.z,
      );
      group.rotation.y = entity.rotation;
      group.scale.setScalar(entity.scale);
      this.world.add(group);
      this.entities.set(entity.id, group);
    }
  }
  selectAgent(id: string) {
    this.selectedAgent = id;
  }
  update(state: WorldStateDto) {
    this.renderer.domElement.setAttribute(
      "aria-label",
      `3D eiland met ${state.agents.map((agent) => agent.name).join(", ")}`,
    );
    this.updateSight(state);
    const presentAgents = new Set(state.agents.map((agent) => agent.id));
    for (const [id, agent] of this.agents) {
      if (!presentAgents.has(id)) {
        this.scene.remove(agent.group);
        this.disposeGroup(agent.group);
        this.agents.delete(id);
      }
    }
    for (const data of state.agents) {
      const existing = this.agents.get(data.id);
      const agent = existing ?? this.createAgent(data.id);
      agent.previous.copy(agent.group.position);
      agent.target.set(data.position.x, data.position.y, data.position.z);
      if (!existing) {
        agent.previous.copy(agent.target);
        agent.group.position.copy(agent.target);
      }
      agent.group.rotation.y = data.orientation;
      agent.receivedAt = performance.now();
    }
    const present = new Set(state.entities.map((e) => e.id));
    for (const [id, group] of this.entities) {
      if (!present.has(id)) {
        this.world.remove(group);
        this.disposeGroup(group);
        this.entities.delete(id);
      }
    }
    for (const entity of state.entities) {
      let group = this.entities.get(entity.id);
      if (!group && entity.type === "item" && !entity.ownerId) {
        group = new THREE.Group();
        const color =
          entity.itemKind === "campfire"
            ? 0xd87c36
            : entity.itemKind === "workbench"
              ? 0x936642
              : 0x8d9867;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 0.7, 0.8),
          new THREE.MeshStandardMaterial({ color }),
        );
        mesh.position.y = 0.4;
        group.add(mesh);
        this.world.add(group);
        this.entities.set(entity.id, group);
      }
      if (!group) continue;
      group.visible = !entity.ownerId;
      group.position.set(
        entity.position.x,
        entity.position.y,
        entity.position.z,
      );
      if (entity.type === "artifact")
        group.traverse((object) => {
          if (
            object instanceof THREE.Mesh &&
            object.material instanceof THREE.MeshStandardMaterial
          )
            object.material.emissiveIntensity = entity.activated ? 2 : 0.6;
        });
    }
  }
  private clearSight() {
    this.disposeGroup(this.sight);
    this.sight.clear();
  }
  private updateSight(state: WorldStateDto) {
    this.clearSight();
    const agent = state.agents.find((a) => a.id === this.selectedAgent);
    if (!agent || !this.definition) return;
    const range = visionRange(agent, state.entities);
    const point = (radius: number, angle: number) => {
      const x = agent.position.x + Math.sin(angle) * radius;
      const z = agent.position.z + Math.cos(angle) * radius;
      return new THREE.Vector3(
        x,
        terrainHeight(this.definition!.terrain, x, z) + 0.35,
        z,
      );
    };
    // Subdivide radially so the sector follows hills as well as its outer arc.
    const vertices: number[] = [];
    const indices: number[] = [];
    const segments = 48;
    const rings = 12;
    for (let r = 0; r <= rings; r++)
      for (let i = 0; i <= segments; i++) {
        const angle =
          agent.orientation + (i / segments - 0.5) * VISION_FIELD_OF_VIEW;
        vertices.push(...point((r / rings) * range, angle).toArray());
        if (r < rings && i < segments) {
          const a = r * (segments + 1) + i;
          const b = a + segments + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setIndex(indices);
    const sector = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0xffd477,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.sight.add(sector);
    const outline = [point(0, 0)];
    for (let i = 0; i <= segments; i++)
      outline.push(
        point(
          range,
          agent.orientation + (i / segments - 0.5) * VISION_FIELD_OF_VIEW,
        ),
      );
    outline.push(point(0, 0));
    for (const points of [
      outline,
      [
        point(12, agent.orientation - 0.22),
        point(17, agent.orientation),
        point(12, agent.orientation + 0.22),
      ],
      Array.from({ length: rings + 1 }, (_, i) =>
        point((i / rings) * range, agent.orientation),
      ),
    ]) {
      this.sight.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: 0xffdd88, depthTest: false }),
        ),
      );
    }
  }
  private disposeGroup(group: THREE.Object3D) {
    group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          material.dispose();
      }
    });
  }
  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.disposeGroup(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
