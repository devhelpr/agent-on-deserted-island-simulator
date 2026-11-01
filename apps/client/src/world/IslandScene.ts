import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WorldDefinition, WorldStateDto } from '../../../../packages/shared/src/index.js';

export class IslandScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.5, 2500);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private world = new THREE.Group();
  private readonly agent = new THREE.Group();
  private readonly target = new THREE.Vector3();
  private readonly previous = new THREE.Vector3();
  private receivedAt = 0;
  private initialized = false;
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x1c4148);
    this.renderer.domElement.setAttribute('aria-label', '3D eiland met servergestuurde testagent Alpha');
    this.host.append(this.renderer.domElement);
    this.scene.fog = new THREE.Fog(0x1c4148, 650, 1300);
    this.scene.add(new THREE.HemisphereLight(0xdaf4ed, 0x59664c, 2.5));
    const sun = new THREE.DirectionalLight(0xffe4b9, 3);
    sun.position.set(-180, 280, 130); this.scene.add(sun);
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(2200, 2200), new THREE.MeshStandardMaterial({ color: 0x235563, roughness: 0.48, metalness: 0.2 }));
    ocean.rotation.x = -Math.PI / 2; ocean.position.y = 0; this.scene.add(ocean);
    this.scene.add(this.world);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 2.5, 4, 8), new THREE.MeshStandardMaterial({ color: 0xffb35d, roughness: 0.65 }));
    body.position.y = 2.3; this.agent.add(body);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.8, 40), new THREE.MeshBasicMaterial({ color: 0xffce83, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.22; this.agent.add(ring);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.5, 3), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    nose.rotation.x = Math.PI / 2; nose.position.set(0, 3, 1.3); this.agent.add(nose);
    this.scene.add(this.agent); this.agent.visible = false;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI / 2 - 0.06;
    this.controls.minDistance = 12; this.controls.maxDistance = 850;
    this.resetCamera();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host); this.resize();
    this.renderer.setAnimationLoop(() => {
      if (this.initialized) this.agent.position.lerpVectors(this.previous, this.target, Math.min(1, (performance.now() - this.receivedAt) / 100));
      this.controls.update(); this.renderer.render(this.scene, this.camera);
    });
  }
  private resize() {
    const width = this.host.clientWidth; const height = this.host.clientHeight;
    this.camera.aspect = width / Math.max(1, height); this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
  resetCamera() { this.camera.position.set(310, 320, 350); this.controls.target.set(0, 5, 0); this.controls.update(); }
  focusAgent() {
    if (!this.initialized) return;
    this.controls.target.copy(this.target);
    this.camera.position.copy(this.target).add(new THREE.Vector3(45, 45, 50));
    this.controls.update();
  }
  load(definition: WorldDefinition) {
    this.disposeGroup(this.world); this.scene.remove(this.world);
    this.world = new THREE.Group(); this.scene.add(this.world);
    const { width, depth, resolution: n, heights } = definition.terrain;
    const geometry = new THREE.PlaneGeometry(width, depth, n - 1, n - 1);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position!;
    const colors: number[] = [];
    for (let i = 0; i < positions.count; i++) {
      const h = heights[i]!; positions.setY(i, h);
      const color = new THREE.Color(h < 1.5 ? 0xd2c190 : h < 8 ? 0x8caa68 : h < 17 ? 0x638356 : 0x7a8566);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
    this.world.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })));
    for (const entity of definition.entities) {
      const group = new THREE.Group();
      if (entity.type === 'tree') {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, 5, 5), new THREE.MeshStandardMaterial({ color: 0x73553a }));
        trunk.position.y = 2.5; group.add(trunk);
        const crown = new THREE.Mesh(new THREE.ConeGeometry(4, 11, 6), new THREE.MeshStandardMaterial({ color: 0x315e44, flatShading: true }));
        crown.position.y = 8; group.add(crown);
      } else if (entity.type === 'rock' || entity.type === 'cave') {
        const cave = entity.type === 'cave';
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(cave ? 8 : 2.3, 0), new THREE.MeshStandardMaterial({ color: cave ? 0x525e5b : 0x93988a, flatShading: true }));
        rock.scale.set(1.25, 0.8, 1); rock.position.y = cave ? 3 : 1; group.add(rock);
        if (cave) {
          const opening = new THREE.Mesh(new THREE.SphereGeometry(3.3, 12, 8), new THREE.MeshStandardMaterial({ color: 0x172a2b }));
          opening.position.set(0, 1.5, 5.5); group.add(opening);
        }
      } else {
        const artifact = new THREE.Mesh(new THREE.OctahedronGeometry(2.5), new THREE.MeshStandardMaterial({ color: 0x77ddcc, emissive: 0x2c776e, emissiveIntensity: 0.6 }));
        artifact.position.y = 3; group.add(artifact);
      }
      group.position.set(entity.position.x, entity.position.y, entity.position.z);
      group.rotation.y = entity.rotation; group.scale.setScalar(entity.scale); this.world.add(group);
    }
    this.initialized = false;
  }
  update(state: WorldStateDto) {
    const alpha = state.agents[0]; if (!alpha) return;
    this.previous.copy(this.agent.position);
    this.target.set(alpha.position.x, alpha.position.y, alpha.position.z);
    if (!this.initialized) { this.previous.copy(this.target); this.agent.position.copy(this.target); }
    this.agent.rotation.y = alpha.orientation;
    this.receivedAt = performance.now(); this.initialized = true; this.agent.visible = true;
  }
  private disposeGroup(group: THREE.Object3D) {
    group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
      }
    });
  }
  dispose() {
    this.renderer.setAnimationLoop(null); this.resizeObserver.disconnect(); this.controls.dispose();
    this.disposeGroup(this.scene); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
