using UnityEngine;

public class ExplodeObject : MonoBehaviour
{
    [SerializeField] Transform intactObject;
    [SerializeField] Transform[] fragments;
    [SerializeField] float minForce = 125;
    [SerializeField] float maxForce = 750;
    [SerializeField] float radius = 10;

    public void Explode() {
        foreach(Transform fragment in fragments) {
            var rigidBody = fragment.gameObject.AddComponent<Rigidbody>();
            var collider = fragment.gameObject.AddComponent<BoxCollider>();

            rigidBody.AddExplosionForce(Random.Range(minForce, maxForce), intactObject.position, radius);
        }
    }

    void Start()
    {
        Explode();
    }

    void Update()
    {
        
    }
}
