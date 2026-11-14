'use client'

import Image from "next/image";
import React, { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';

interface Position{
  x: number;
  y: number;
  z: number;
}

const ThreeScene: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const meshesRef = useRef<THREE.Mesh[]>([]);

  const rightHandPositionRef = useRef<Position>(null);
  const leftHandPositionRef = useRef<Position>(null);

  const addGeometry = useCallback((position: Position) => {
    const scene = sceneRef.current;
    if(!scene) return null;

    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, position.y, position.z);
    
    scene.add(mesh);
    meshesRef.current.push(mesh);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if(!container) return;
    
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    containerRef.current?.appendChild(renderer.domElement);
    
    addGeometry({x: 0, y: 0, z: 0});
    addGeometry({x: 2, y: 1, z: 2});

    let frameId: number;
    const renderScene = () => {
      meshesRef.current.forEach((mesh) => {
        mesh.rotation.x += 0.01;
        mesh.rotation.y += 0.01;
      });
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(renderScene);
    };
    // Render the scene and camera
    renderScene();

    return () => {
      cancelAnimationFrame(frameId);
      meshesRef.current.forEach((mesh) => {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      });
      meshesRef.current = [];
      sceneRef.current = null;
      container.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [addGeometry]);
  return <div ref={containerRef} />;
};
export default ThreeScene;
