import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import ActorMovieCard from '../components/ActorMovieCard';
import ActorModal from '../components/ActorModal';
import { actors } from '../data/actors';

const AllActorsPage = () => {
  const navigate = useNavigate();
  const { type } = useParams(); // 'actors' or 'actresses'
  const [selectedActor, setSelectedActor] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const actorsList = type === 'actresses' 
    ? actors.filter(a => a.type === 'actress')
    : actors.filter(a => a.type === 'actor');

  const handleActorSelect = (actor) => {
    setSelectedActor(actor);
    setIsModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#141414] pt-24 pb-10">
      <div className="px-4 md:px-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-4xl md:text-5xl font-black text-white">
            {type === 'actresses' ? 'Popular Actresses' : 'Popular Actors'}
          </h1>
          <button
            onClick={() => navigate('/')}
            className="w-10 h-10 bg-[#2a2a2a] hover:bg-[#E50914] 
                       rounded-full flex items-center justify-center 
                       text-white transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-3 sm:grid-cols-4 
                        md:grid-cols-5 lg:grid-cols-6 gap-4">
          {actorsList.map(actor => (
            <ActorMovieCard
              key={actor.id}
              actor={actor}
              onActorClick={handleActorSelect}
            />
          ))}
        </div>
      </div>

      {/* Modal */}
      <ActorModal
        actor={selectedActor}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
};

export default AllActorsPage;
